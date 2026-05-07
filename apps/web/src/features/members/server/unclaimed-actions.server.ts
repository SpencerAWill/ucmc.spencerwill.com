/**
 * Action implementations for officer-pre-added "unclaimed" member stubs.
 *
 * Officers pre-add real-world current members (name + email) so that
 * off-platform associations like gear holdings can FK to a stable
 * `users.id` before the person ever signs in. The pre-added row sits
 * in `users` with `status="unclaimed"`, `placeholderName` + `unclaimedAt`
 * populated, and a primary `user_emails` row with `verifiedAt = NULL`.
 *
 * When the real person clicks their first magic link to that address,
 * the consume handler stamps `verifiedAt`, opens a session, and routes
 * them to `/register/profile`. On profile submit the row is auto-
 * approved (status flips to "approved", placeholder columns NULLed) —
 * the officer's pre-add IS the approval signal, so the user skips the
 * normal pending queue. See `magic-link-actions.server.ts` for the
 * claim path.
 *
 * Permission: `registrations:approve` (the same officers who handle
 * registration approval also pre-add gear holders). Tightened later
 * via a separate `members:preadd` permission if granular RBAC is
 * needed.
 */
import { and, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { requireApprover } from "#/features/members/server/member-actions.server";
import {
  recordAuditEvent,
  recordAuditEvents,
} from "#/server/audit/audit-log.server";
import { normalizeEmail } from "#/server/auth/email-normalize";
import { generateUserPublicId } from "#/server/auth/ids";
import { getDb, isUniqueViolation, schema } from "#/server/db";

const DEFAULT_LIMIT = 50;

/** Server-side cap on how many entries a single bulk pre-add accepts.
 *  Mirrored client-side in the bulk-add sheet so the user gets a clear
 *  warning before submit. */
export const PRE_ADD_BATCH_CAP = 200;

// ── list ────────────────────────────────────────────────────────────────

export interface UnclaimedMember {
  userId: string;
  publicId: string;
  placeholderName: string;
  email: string;
  unclaimedAt: Date;
}

export interface UnclaimedMembersPage {
  rows: UnclaimedMember[];
  total: number;
}

export async function listUnclaimedAction(opts: {
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<UnclaimedMembersPage> {
  await requireApprover();
  const db = getDb();

  const conditions = [eq(schema.users.status, "unclaimed")];
  if (opts.from) {
    conditions.push(
      gte(schema.users.unclaimedAt, new Date(`${opts.from}T00:00:00.000Z`)),
    );
  }
  if (opts.to) {
    conditions.push(
      lte(schema.users.unclaimedAt, new Date(`${opts.to}T23:59:59.999Z`)),
    );
  }
  const where = and(...conditions);

  const [countResult, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.users).where(where),
    db
      .select({
        userId: schema.users.id,
        publicId: schema.users.publicId,
        placeholderName: schema.users.placeholderName,
        email: schema.userEmails.email,
        unclaimedAt: schema.users.unclaimedAt,
      })
      .from(schema.users)
      .innerJoin(
        schema.userEmails,
        and(
          eq(schema.userEmails.userId, schema.users.id),
          eq(schema.userEmails.isPrimary, true),
        ),
      )
      .where(where)
      .orderBy(desc(schema.users.unclaimedAt))
      .limit(opts.limit ?? DEFAULT_LIMIT)
      .offset(opts.offset ?? 0),
  ]);

  return {
    total: countResult[0]?.value ?? 0,
    // Filter out any row missing placeholderName/unclaimedAt — should be
    // impossible while status="unclaimed" (they're always set together
    // at insert), but keeps the public type non-null.
    rows: rows.flatMap((r) =>
      r.placeholderName !== null && r.unclaimedAt !== null
        ? [
            {
              userId: r.userId,
              publicId: r.publicId,
              placeholderName: r.placeholderName,
              email: r.email,
              unclaimedAt: r.unclaimedAt,
            },
          ]
        : [],
    ),
  };
}

// ── pre-add (bulk) ──────────────────────────────────────────────────────

export interface PreAddEntry {
  name: string;
  email: string;
}

export type PreAddSkipReason = "email_taken" | "duplicate_in_batch" | "invalid";

export interface PreAddCreated {
  userId: string;
  publicId: string;
  name: string;
  email: string;
}

export interface PreAddSkipped {
  email: string;
  name: string;
  reason: PreAddSkipReason;
}

export interface PreAddResult {
  created: PreAddCreated[];
  skipped: PreAddSkipped[];
}

export async function preAddUnclaimedMembersAction(args: {
  entries: PreAddEntry[];
}): Promise<PreAddResult> {
  const approver = await requireApprover();
  const db = getDb();

  if (args.entries.length === 0) {
    throw new Error("No entries provided");
  }
  if (args.entries.length > PRE_ADD_BATCH_CAP) {
    throw new Error(`Too many entries (max ${PRE_ADD_BATCH_CAP} per submit)`);
  }

  // First pass: normalize emails + dedupe within the batch. Hitting the
  // user_emails UNIQUE constraint with two identical emails in one
  // submit would fail the second insert with a confusing error; pre-
  // catching it lets us return a clean per-row "duplicate_in_batch"
  // skip reason.
  const seen = new Set<string>();
  const normalized: Array<
    | { kind: "ok"; name: string; email: string }
    | { kind: "skip"; name: string; email: string; reason: PreAddSkipReason }
  > = [];
  for (const entry of args.entries) {
    const name = entry.name.trim();
    const email = normalizeEmail(entry.email);
    if (seen.has(email)) {
      normalized.push({
        kind: "skip",
        name,
        email,
        reason: "duplicate_in_batch",
      });
      continue;
    }
    seen.add(email);
    normalized.push({ kind: "ok", name, email });
  }

  const created: PreAddCreated[] = [];
  const skipped: PreAddSkipped[] = [];
  for (const entry of normalized) {
    if (entry.kind === "skip") {
      skipped.push({
        email: entry.email,
        name: entry.name,
        reason: entry.reason,
      });
      continue;
    }
    const newUserId = `user_${uuidv7()}`;
    const publicId = generateUserPublicId();
    const now = new Date();
    try {
      await db.batch([
        db.insert(schema.users).values({
          id: newUserId,
          publicId,
          status: "unclaimed",
          placeholderName: entry.name,
          unclaimedAt: now,
        }),
        db.insert(schema.userEmails).values({
          id: `uem_${uuidv7()}`,
          userId: newUserId,
          email: entry.email,
          isPrimary: true,
          verifiedAt: null,
        }),
      ]);
      created.push({
        userId: newUserId,
        publicId,
        name: entry.name,
        email: entry.email,
      });
    } catch (err) {
      if (isUniqueViolation(err, "user_emails.email")) {
        skipped.push({
          email: entry.email,
          name: entry.name,
          reason: "email_taken",
        });
        continue;
      }
      throw err;
    }
  }

  // One audit event per successfully created row. Metadata captures
  // both name and email — see the documented exception in
  // `apps/web/drizzle/schema.ts` audit-log doc-comment.
  await recordAuditEvents(
    created.map((row) => ({
      actorUserId: approver.userId,
      action: "member.pre_added",
      targetUserId: row.userId,
      metadata: { email: row.email, placeholderName: row.name },
    })),
  );

  return { created, skipped };
}

// ── edit ────────────────────────────────────────────────────────────────

export type EditUnclaimedError =
  | { kind: "not_found" }
  | { kind: "not_unclaimed" }
  | { kind: "email_taken" };

export type EditUnclaimedResult =
  | { ok: true }
  | { ok: false; error: EditUnclaimedError };

export async function editUnclaimedMemberAction(args: {
  userId: string;
  name: string;
  email: string;
}): Promise<EditUnclaimedResult> {
  const approver = await requireApprover();
  const db = getDb();

  const newName = args.name.trim();
  const newEmail = normalizeEmail(args.email);

  // Load current state — both for the not-found / wrong-status guards
  // and for the audit metadata's `before` snapshot.
  const userRow = await db
    .select({
      status: schema.users.status,
      placeholderName: schema.users.placeholderName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, args.userId))
    .get();
  if (!userRow) {
    return { ok: false, error: { kind: "not_found" } };
  }
  if (userRow.status !== "unclaimed") {
    return { ok: false, error: { kind: "not_unclaimed" } };
  }

  const emailRow = await db
    .select({ id: schema.userEmails.id, email: schema.userEmails.email })
    .from(schema.userEmails)
    .where(
      and(
        eq(schema.userEmails.userId, args.userId),
        eq(schema.userEmails.isPrimary, true),
      ),
    )
    .get();
  if (!emailRow) {
    // No primary email row for an unclaimed user violates the invariant
    // — a pre-added row always has its primary inserted in the same
    // batch. Treat as not_found so the UI can surface a clean error
    // instead of crashing.
    return { ok: false, error: { kind: "not_found" } };
  }

  const before = {
    name: userRow.placeholderName ?? "",
    email: emailRow.email,
  };

  if (before.name === newName && before.email === newEmail) {
    return { ok: true };
  }

  const stmts: Parameters<typeof db.batch>[0][number][] = [];
  if (before.name !== newName) {
    stmts.push(
      db
        .update(schema.users)
        .set({ placeholderName: newName })
        .where(eq(schema.users.id, args.userId)),
    );
  }
  if (before.email !== newEmail) {
    stmts.push(
      db
        .update(schema.userEmails)
        .set({ email: newEmail })
        .where(eq(schema.userEmails.id, emailRow.id)),
    );
  }

  try {
    await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);
  } catch (err) {
    if (isUniqueViolation(err, "user_emails.email")) {
      return { ok: false, error: { kind: "email_taken" } };
    }
    throw err;
  }

  await recordAuditEvent({
    actorUserId: approver.userId,
    action: "member.unclaimed_edited",
    targetUserId: args.userId,
    metadata: {
      before,
      after: { name: newName, email: newEmail },
    },
  });

  return { ok: true };
}

// ── delete (bulk) ───────────────────────────────────────────────────────

export interface DeleteUnclaimedResult {
  deletedIds: string[];
}

export async function deleteUnclaimedMembersAction(args: {
  userIds: string[];
}): Promise<DeleteUnclaimedResult> {
  const approver = await requireApprover();
  const db = getDb();

  if (args.userIds.length === 0) {
    return { deletedIds: [] };
  }

  // Snapshot the pre-deletion identity (placeholderName + primary email)
  // so the audit row stays meaningful after the user row + cascading
  // user_emails row are gone.
  const snapshot = await db
    .select({
      userId: schema.users.id,
      placeholderName: schema.users.placeholderName,
      email: schema.userEmails.email,
    })
    .from(schema.users)
    .innerJoin(
      schema.userEmails,
      and(
        eq(schema.userEmails.userId, schema.users.id),
        eq(schema.userEmails.isPrimary, true),
      ),
    )
    .where(
      and(
        inArray(schema.users.id, args.userIds),
        eq(schema.users.status, "unclaimed"),
      ),
    );

  if (snapshot.length === 0) {
    return { deletedIds: [] };
  }

  const idsToDelete = snapshot.map((row) => row.userId);
  // Filter on `status="unclaimed"` again at delete time so a concurrent
  // claim doesn't race in and we accidentally hard-delete a freshly-
  // approved user. ON DELETE CASCADE handles the user_emails cleanup.
  const deleted = await db
    .delete(schema.users)
    .where(
      and(
        inArray(schema.users.id, idsToDelete),
        eq(schema.users.status, "unclaimed"),
      ),
    )
    .returning({ id: schema.users.id });
  const deletedIds = new Set(deleted.map((row) => row.id));

  await recordAuditEvents(
    snapshot
      .filter((row) => deletedIds.has(row.userId))
      .map((row) => ({
        actorUserId: approver.userId,
        action: "member.unclaimed_deleted",
        targetUserId: null,
        metadata: {
          email: row.email,
          placeholderName: row.placeholderName ?? "",
        },
      })),
  );

  return { deletedIds: Array.from(deletedIds) };
}
