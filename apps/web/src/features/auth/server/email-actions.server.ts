/**
 * Server-side actions for managing the verified email addresses
 * attached to a user account: list, request-add, consume-add, remove,
 * promote-to-primary.
 *
 * Adding an email is a two-step round-trip — the request action sends a
 * magic link to the new address with `intent = "add_email"` and
 * `target_user_id = caller`; the consume action requires that the same
 * caller (matched on `session.userId === target_user_id`) clicks the
 * link, then attaches the row. This blocks the cross-account "attacker
 * requests link to victim's address; victim clicks while signed in as
 * themselves; address ends up on attacker's account" attack.
 *
 * Removal blocks the primary email. Combined with the partial-unique
 * "exactly one primary per user" invariant, that also blocks removing
 * the last remaining row — every user always has a primary, and the
 * primary is unremovable until another row is promoted via the
 * primary-swap path. Primary promotion is a `db.batch` swap
 * (clear-then-set) because SQLite enforces partial-unique indexes at
 * statement boundaries, not transaction boundaries.
 *
 * The shell in `./email-fns.ts` dynamic-imports each action so server-
 * only code never reaches the client bundle.
 */
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { normalizeEmail } from "#/server/auth/email-normalize";
import {
  consumeMagicLink,
  requestMagicLink,
} from "#/features/auth/server/magic-link.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { getDb, isUniqueViolation, schema } from "#/server/db";
import {
  checkAuthRateLimitByEmail,
  checkAuthRateLimitByIp,
} from "#/server/rate-limit.server";

export interface EmailRow {
  id: string;
  email: string;
  isPrimary: boolean;
  verifiedAt: Date;
  createdAt: Date;
}

export type ListMyEmailsResult =
  | { ok: true; emails: EmailRow[] }
  | { ok: false; reason: "unauthorized" };

export type RequestAddEmailResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unauthorized"
        | "not_approved"
        | "rate_limited"
        | "email_taken"
        | "already_yours";
    };

export type ConsumeAddEmailResult =
  | { ok: true; email: string }
  | {
      ok: false;
      reason:
        | "unauthorized"
        | "rate_limited"
        | "invalid"
        | "wrong_user"
        | "email_taken";
    };

export type RemoveEmailResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unauthorized" | "not_approved" | "not_found" | "is_primary";
    };

export type SetPrimaryEmailResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unauthorized" | "not_approved" | "not_found" | "already_primary";
    };

// ── list ────────────────────────────────────────────────────────────────

export async function listMyEmailsAction(): Promise<ListMyEmailsResult> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    return { ok: false, reason: "unauthorized" };
  }
  const rows = await getDb()
    .select({
      id: schema.userEmails.id,
      email: schema.userEmails.email,
      isPrimary: schema.userEmails.isPrimary,
      verifiedAt: schema.userEmails.verifiedAt,
      createdAt: schema.userEmails.createdAt,
    })
    .from(schema.userEmails)
    .where(eq(schema.userEmails.userId, principal.userId));
  // Primary first, then by createdAt ascending so the UI is stable.
  rows.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  return { ok: true, emails: rows };
}

// ── add (request) ───────────────────────────────────────────────────────

export async function requestAddEmailAction(args: {
  email: string;
}): Promise<RequestAddEmailResult> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    return { ok: false, reason: "unauthorized" };
  }
  // Approval gate. Pending users keep their single registration
  // email; they cannot add additional addresses.
  if (principal.status !== "approved") {
    return { ok: false, reason: "not_approved" };
  }
  const email = normalizeEmail(args.email);

  if (!(await checkAuthRateLimitByIp())) {
    return { ok: false, reason: "rate_limited" };
  }
  if (!(await checkAuthRateLimitByEmail(email))) {
    return { ok: false, reason: "rate_limited" };
  }

  // Pre-check: surface a fast, helpful "email_taken" or "already_yours"
  // before sending a magic link the recipient can't act on. The actual
  // race-safety boundary is the UNIQUE(email) constraint at consume
  // time; this is a UX layer.
  const existing = await getDb().query.userEmails.findFirst({
    where: eq(schema.userEmails.email, email),
    columns: { userId: true },
  });
  if (existing) {
    if (existing.userId === principal.userId) {
      return { ok: false, reason: "already_yours" };
    }
    return { ok: false, reason: "email_taken" };
  }

  await requestMagicLink({
    email,
    intent: "add_email",
    targetUserId: principal.userId,
  });
  return { ok: true };
}

// ── add (consume) ───────────────────────────────────────────────────────

export async function consumeAddEmailAction(
  token: string,
): Promise<ConsumeAddEmailResult> {
  if (!(await checkAuthRateLimitByIp())) {
    return { ok: false, reason: "rate_limited" };
  }

  const principal = await loadCurrentPrincipal();
  if (!principal) {
    return { ok: false, reason: "unauthorized" };
  }

  const proof = await consumeMagicLink(token);
  if (!proof || proof.intent !== "add_email") {
    return { ok: false, reason: "invalid" };
  }
  // Cross-account guard: the link's target_user_id must equal the
  // currently signed-in user. If a stranger requested a link to your
  // address and you click it while signed in to your own account, this
  // refuses — the email never attaches to anyone.
  if (proof.targetUserId !== principal.userId) {
    return { ok: false, reason: "wrong_user" };
  }

  const email = normalizeEmail(proof.email);
  const db = getDb();
  try {
    await db.insert(schema.userEmails).values({
      id: `uem_${uuidv7()}`,
      userId: principal.userId,
      email,
      isPrimary: false,
      verifiedAt: new Date(),
    });
  } catch (err) {
    if (isUniqueViolation(err, "user_emails.email")) {
      // The address was claimed by another account between the
      // request and the consume. The pre-check at request time would
      // have caught the common case; this branch covers the race.
      return { ok: false, reason: "email_taken" };
    }
    throw err;
  }

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "email.added",
    targetUserId: principal.userId,
    metadata: { email },
  });
  return { ok: true, email };
}

// ── remove ──────────────────────────────────────────────────────────────

export async function removeEmailAction(args: {
  emailId: string;
}): Promise<RemoveEmailResult> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    return { ok: false, reason: "unauthorized" };
  }
  if (principal.status !== "approved") {
    return { ok: false, reason: "not_approved" };
  }

  const db = getDb();
  const row = await db.query.userEmails.findFirst({
    where: and(
      eq(schema.userEmails.id, args.emailId),
      eq(schema.userEmails.userId, principal.userId),
    ),
  });
  if (!row) {
    return { ok: false, reason: "not_found" };
  }
  if (row.isPrimary) {
    // Two-step UX: promote another row to primary first, then remove
    // the old primary. Allowing direct removal would leave the user
    // with no primary mid-transaction even with the safest ordering.
    return { ok: false, reason: "is_primary" };
  }

  await db
    .delete(schema.userEmails)
    .where(eq(schema.userEmails.id, args.emailId));

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "email.removed",
    targetUserId: principal.userId,
    metadata: { email: row.email },
  });
  return { ok: true };
}

// ── set primary ─────────────────────────────────────────────────────────

export async function setPrimaryEmailAction(args: {
  emailId: string;
}): Promise<SetPrimaryEmailResult> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    return { ok: false, reason: "unauthorized" };
  }
  if (principal.status !== "approved") {
    return { ok: false, reason: "not_approved" };
  }

  const db = getDb();
  const target = await db.query.userEmails.findFirst({
    where: and(
      eq(schema.userEmails.id, args.emailId),
      eq(schema.userEmails.userId, principal.userId),
    ),
  });
  if (!target) {
    return { ok: false, reason: "not_found" };
  }
  if (target.isPrimary) {
    return { ok: false, reason: "already_primary" };
  }

  // Clear-then-set inside db.batch. SQLite checks the partial unique
  // index at statement boundaries, so the existing primary must be
  // demoted before the new one is promoted; otherwise the index would
  // see two `is_primary = 1` rows for the same user mid-batch.
  await db.batch([
    db
      .update(schema.userEmails)
      .set({ isPrimary: false })
      .where(
        and(
          eq(schema.userEmails.userId, principal.userId),
          eq(schema.userEmails.isPrimary, true),
        ),
      ),
    db
      .update(schema.userEmails)
      .set({ isPrimary: true })
      .where(eq(schema.userEmails.id, args.emailId)),
  ]);

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "email.primary_changed",
    targetUserId: principal.userId,
    metadata: { newPrimaryEmail: target.email },
  });
  return { ok: true };
}
