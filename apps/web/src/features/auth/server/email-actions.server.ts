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
 * Removal blocks the primary email outright (`is_primary`) and refuses
 * to leave the row count at zero (`is_last`, belt-and-suspenders
 * against the partial-unique invariant ever breaking). Primary
 * promotion is a `db.batch` swap (clear-then-set) because SQLite
 * enforces partial-unique indexes at statement boundaries, not
 * transaction boundaries.
 *
 * The shell in `./email-fns.ts` dynamic-imports each action so server-
 * only code never reaches the client bundle.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import {
  buildAuditEventStatement,
  recordAuditEvent,
} from "#/server/audit/audit-log.server";
import { isEmailBanned } from "#/server/auth/email-blocklist.server";
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
  // Nullable to track the schema (NULL = "officer pre-added, not yet
  // claimed"). This action is only callable by an authenticated user;
  // approved users always have non-null `verifiedAt` on every row,
  // because the only path that inserts NULL is officer pre-add and
  // those users can't reach the /my/account/details page that consumes
  // this. The type widening keeps the contract honest.
  verifiedAt: Date | null;
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
        | "already_yours"
        // Address is on the `banned_emails` blocklist. UX renders this
        // as a generic "this address can't be added" — surfacing the
        // ban reason would leak details about another account.
        | "email_unavailable";
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
        | "email_taken"
        // Address landed on the blocklist between request and consume.
        // Folded into a separate reason rather than `invalid` so the
        // user-facing toast can explain accurately and the audit /
        // observability surface stays clean.
        | "email_unavailable";
    };

export type RemoveEmailResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unauthorized"
        | "not_approved"
        | "not_found"
        | "is_primary"
        | "is_last";
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
  // Primary first, then by createdAt ascending, with `id` as the
  // final tiebreaker so the order is stable even when two rows share
  // the same millisecond `createdAt` (e.g. back-to-back inserts in a
  // `db.batch`). Without the id tiebreaker, a refresh could reshuffle
  // tied rows and the "Make primary"/"Remove" buttons would jump.
  const rows = await getDb()
    .select({
      id: schema.userEmails.id,
      email: schema.userEmails.email,
      isPrimary: schema.userEmails.isPrimary,
      verifiedAt: schema.userEmails.verifiedAt,
      createdAt: schema.userEmails.createdAt,
    })
    .from(schema.userEmails)
    .where(eq(schema.userEmails.userId, principal.userId))
    .orderBy(
      desc(schema.userEmails.isPrimary),
      asc(schema.userEmails.createdAt),
      asc(schema.userEmails.id),
    );
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

  // Blocklist check — refuse to send a magic link to a banned address
  // even if the address has no `user_emails` row. Without this, the
  // post-ban / post-purge case (banned user self-deleted, blocklist
  // row survives, address looks "available") would let a different
  // approved user attach the banned address to their own account.
  if (await isEmailBanned(email)) {
    return { ok: false, reason: "email_unavailable" };
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

  // Re-check the blocklist at consume time. The pre-check at request
  // time would have caught the common case, but a ban may have landed
  // between request and consume — the magic-link is already minted and
  // delivered, so this is the last gate before the address attaches.
  if (await isEmailBanned(email)) {
    return { ok: false, reason: "email_unavailable" };
  }

  const db = getDb();
  try {
    // Insert + audit in one batch — the email is known up front, so
    // the audit metadata doesn't need to be derived from `.returning()`.
    // D1 commits both atomically.
    await db.batch([
      db.insert(schema.userEmails).values({
        id: `uem_${uuidv7()}`,
        userId: principal.userId,
        email,
        isPrimary: false,
        verifiedAt: new Date(),
      }),
      buildAuditEventStatement({
        actorUserId: principal.userId,
        action: "email.added",
        targetUserId: principal.userId,
        metadata: { email },
      }),
    ]);
  } catch (err) {
    if (isUniqueViolation(err, "user_emails.email")) {
      // The address was claimed by another account between the
      // request and the consume. The pre-check at request time would
      // have caught the common case; this branch covers the race.
      // The whole batch rolls back, so no orphan audit row.
      return { ok: false, reason: "email_taken" };
    }
    throw err;
  }

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
  // One read fetches the target row plus the total count for the user
  // via a correlated subquery. The result is bounded to one row even
  // when the user has many addresses — `select all rows for user` was
  // unbounded and could spike memory on a pathological email list.
  const rows = await db
    .select({
      id: schema.userEmails.id,
      email: schema.userEmails.email,
      isPrimary: schema.userEmails.isPrimary,
      totalForUser: sql<number>`(SELECT COUNT(*) FROM ${schema.userEmails} WHERE ${schema.userEmails.userId} = ${principal.userId})`,
    })
    .from(schema.userEmails)
    .where(
      and(
        eq(schema.userEmails.id, args.emailId),
        eq(schema.userEmails.userId, principal.userId),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  const row = rows[0];
  if (row.isPrimary) {
    // Two-step UX: promote another row to primary first, then remove
    // the old primary. Allowing direct removal would leave the user
    // with no primary mid-transaction even with the safest ordering.
    return { ok: false, reason: "is_primary" };
  }

  // Belt-and-suspenders row-count guard. The partial-unique "exactly
  // one primary per user" invariant means a non-primary row implies
  // the user also has a primary (>=2 total) so this branch is
  // unreachable under normal operation. But the invariant is enforced
  // by the index, not by transaction-level state, so a future bug or
  // manual SQL could reach a "no primary" state — without this check,
  // `removeEmailAction` would happily delete the last row. Refuse and
  // return `is_last` instead so the failure surfaces.
  //
  // The UI side (`email-addresses-section.tsx`) doesn't render a
  // distinct toast for `is_last` because the disabled-button gate
  // (`onlyOne`) prevents the user from triggering this branch in the
  // first place; the action-level guard is purely defense-in-depth
  // for direct API callers (tests, future scripts) and the invariant-
  // breaking edge case described above.
  if (row.totalForUser <= 1) {
    return { ok: false, reason: "is_last" };
  }

  // Delete + audit in one batch so the audit row can't survive a
  // delete that ultimately fails (or vice versa).
  await db.batch([
    db.delete(schema.userEmails).where(eq(schema.userEmails.id, args.emailId)),
    buildAuditEventStatement({
      actorUserId: principal.userId,
      action: "email.removed",
      targetUserId: principal.userId,
      metadata: { email: row.email },
    }),
  ]);
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
  //
  // The demote is gated on an EXISTS check against the target row so
  // a concurrent delete between the findFirst above and this batch
  // can't strand the user with no primary: if the target has gone
  // missing, the demote no-ops, the promote affects zero rows, and
  // we surface `not_found` below. Without the gate, the demote would
  // succeed unconditionally and the promote's WHERE would match
  // nothing.
  //
  // Audit stays sequential (out of the batch) because the audit log
  // is append-only — bundling here would either require a phantom
  // row when the gated demote no-ops, or a compensating delete that
  // violates the append-only invariant.
  const [, promoted] = await db.batch([
    db
      .update(schema.userEmails)
      .set({ isPrimary: false })
      .where(
        and(
          eq(schema.userEmails.userId, principal.userId),
          eq(schema.userEmails.isPrimary, true),
          sql`EXISTS (SELECT 1 FROM ${schema.userEmails} WHERE ${schema.userEmails.id} = ${args.emailId} AND ${schema.userEmails.userId} = ${principal.userId})`,
        ),
      ),
    db
      .update(schema.userEmails)
      .set({ isPrimary: true })
      .where(
        and(
          eq(schema.userEmails.id, args.emailId),
          eq(schema.userEmails.userId, principal.userId),
        ),
      )
      .returning({ id: schema.userEmails.id }),
  ]);
  if (promoted.length === 0) {
    // Target row was deleted between findFirst and the batch. The
    // gated demote no-oped, so the user's previous primary is still
    // primary. Tell the caller the target is gone.
    return { ok: false, reason: "not_found" };
  }

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "email.primary_changed",
    targetUserId: principal.userId,
    // Use the same `email` key as `email.added` / `email.removed` so
    // audit consumers can read the affected address from one place
    // across all three lifecycle events. The semantic ("the email
    // that became primary") is implied by the action name.
    metadata: { email: target.email },
  });
  return { ok: true };
}
