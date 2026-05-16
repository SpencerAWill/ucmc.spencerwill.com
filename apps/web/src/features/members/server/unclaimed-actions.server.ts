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
 * Permission: `members:manage` (the same officers who run the rest of
 * the member-management surface also pre-add gear holders). Tightened
 * later via a separate `members:preadd` permission if granular RBAC is
 * needed.
 */
import { and, count, desc, eq, exists, gte, inArray, lte } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { requireMembersManager } from "#/features/members/server/permissions.server";
import {
  buildAuditEventStatement,
  buildBulkAuditEventStatement,
  recordAuditEvents,
} from "#/server/audit/audit-log.server";
import { normalizeEmail } from "#/server/auth/email-normalize";
import { generatePublicId } from "#/server/auth/ids";
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
  await requireMembersManager();
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

export type PreAddSkipReason = "email_taken" | "duplicate_in_batch";

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

export type PreAddError =
  | { kind: "no_entries" }
  | { kind: "too_many_entries"; cap: number; received: number };

/**
 * Discriminated success/error union so cap and empty-batch failures
 * arrive at the call site as structured data instead of as thrown
 * `Error` strings the UI has to regex. Authorization errors still
 * throw — those are infrastructural (caller is unauthenticated /
 * unauthorized) rather than input-shape problems.
 */
export type PreAddResult =
  | { ok: true; created: PreAddCreated[]; skipped: PreAddSkipped[] }
  | { ok: false; error: PreAddError };

export async function preAddUnclaimedMembersAction(args: {
  entries: PreAddEntry[];
}): Promise<PreAddResult> {
  const approver = await requireMembersManager();
  const db = getDb();

  if (args.entries.length === 0) {
    return { ok: false, error: { kind: "no_entries" } };
  }
  if (args.entries.length > PRE_ADD_BATCH_CAP) {
    return {
      ok: false,
      error: {
        kind: "too_many_entries",
        cap: PRE_ADD_BATCH_CAP,
        received: args.entries.length,
      },
    };
  }

  // First pass: normalize emails + dedupe within the batch. Hitting the
  // user_emails UNIQUE constraint with two identical emails in one
  // submit would fail the second insert with a confusing error; pre-
  // catching it lets us return a clean per-row "duplicate_in_batch"
  // skip reason.
  type OkEntry = { name: string; email: string };
  const seen = new Set<string>();
  const okEntries: OkEntry[] = [];
  const skipped: PreAddSkipped[] = [];
  for (const entry of args.entries) {
    const name = entry.name.trim();
    const email = normalizeEmail(entry.email);
    if (seen.has(email)) {
      skipped.push({ name, email, reason: "duplicate_in_batch" });
      continue;
    }
    seen.add(email);
    okEntries.push({ name, email });
  }

  if (okEntries.length === 0) {
    return { ok: true, created: [], skipped };
  }

  // Pre-check existing addresses in one SELECT so the common case turns
  // into "1 read + 1 atomic batch insert" instead of N round-trips.
  // The actual race-safety boundary is still the user_emails
  // UNIQUE(email) constraint — we fall back to per-row inserts on the
  // (rare) collision that slips between the pre-check and the bulk
  // INSERT (concurrent officer pre-add).
  const candidateEmails = okEntries.map((e) => e.email);
  const taken = await db
    .select({ email: schema.userEmails.email })
    .from(schema.userEmails)
    .where(inArray(schema.userEmails.email, candidateEmails));
  const takenSet = new Set(taken.map((row) => row.email));

  const toCreate: OkEntry[] = [];
  for (const entry of okEntries) {
    if (takenSet.has(entry.email)) {
      skipped.push({
        name: entry.name,
        email: entry.email,
        reason: "email_taken",
      });
    } else {
      toCreate.push(entry);
    }
  }

  if (toCreate.length === 0) {
    return { ok: true, created: [], skipped };
  }

  // Generate IDs upfront so the audit row's targetUserId can land in
  // the same batch as the user/user_emails inserts.
  const now = new Date();
  const created: PreAddCreated[] = toCreate.map((entry) => ({
    userId: `user_${uuidv7()}`,
    publicId: generatePublicId(),
    name: entry.name,
    email: entry.email,
  }));

  const userInserts = db.insert(schema.users).values(
    created.map((row) => ({
      id: row.userId,
      publicId: row.publicId,
      status: "unclaimed" as const,
      placeholderName: row.name,
      unclaimedAt: now,
    })),
  );
  const emailInserts = db.insert(schema.userEmails).values(
    created.map((row) => ({
      id: `uem_${uuidv7()}`,
      userId: row.userId,
      email: row.email,
      isPrimary: true,
      verifiedAt: null,
    })),
  );
  // Audit metadata captures both name and email — see the documented
  // exception in `apps/web/drizzle/schema.ts` audit-log doc-comment.
  // Bundling into the same `db.batch` makes the pre-add atomic with
  // its audit row(s), so a failed batch can't strand a created user
  // without an audit trail.
  const auditInsert = buildBulkAuditEventStatement(
    created.map((row) => ({
      actorUserId: approver.userId,
      action: "member.pre_added",
      targetUserId: row.userId,
      metadata: { email: row.email, placeholderName: row.name },
    })),
  );

  try {
    // `auditInsert` is non-null whenever `created.length > 0`, which is
    // guaranteed at this point (we returned early above when toCreate
    // was empty). The narrow keeps drizzle's batch tuple type happy.
    if (!auditInsert) {
      throw new Error("audit insert missing for non-empty created list");
    }
    await db.batch([userInserts, emailInserts, auditInsert]);
    return { ok: true, created, skipped };
  } catch (err) {
    if (!isUniqueViolation(err, "user_emails.email")) {
      throw err;
    }
    // Concurrent pre-add slipped an email in between our SELECT and
    // INSERT. Fall back to per-row inserts so we can pinpoint which
    // address(es) collided and isolate them as `email_taken` skips
    // without rolling back the rest. Rare path; the bulk INSERT covers
    // the common case.
    return preAddPerRowFallback(approver.userId, okEntries, skipped, db);
  }
}

/**
 * Per-row fallback when the bulk pre-add INSERT hit a UNIQUE-violation
 * race. Inserts each row in its own atomic batch so a single collision
 * only skips that row; other rows still land.
 *
 * The audit insert rides in the same `db.batch` as the user/email
 * inserts so a worker death (or audit failure) can never strand a
 * created stub without an audit row — same atomicity guarantee the
 * bulk-path docstring relies on. The marginal cost is one extra
 * statement per row in an already O(N) path.
 *
 * Pre-existing `skipped` from the bulk path's pre-check (within-batch
 * duplicates + emails detected as taken in the SELECT) are passed
 * through and merged with any further `email_taken` skips this fallback
 * uncovers.
 */
async function preAddPerRowFallback(
  approverUserId: string,
  okEntries: Array<{ name: string; email: string }>,
  preExistingSkipped: PreAddSkipped[],
  db: ReturnType<typeof getDb>,
): Promise<PreAddResult> {
  const created: PreAddCreated[] = [];
  const skipped: PreAddSkipped[] = [...preExistingSkipped];
  const now = new Date();

  for (const entry of okEntries) {
    // Skip entries the bulk-path pre-check already classified as
    // `email_taken` — they're already in `preExistingSkipped`.
    if (skipped.some((s) => s.email === entry.email)) {
      continue;
    }
    const userId = `user_${uuidv7()}`;
    const publicId = generatePublicId();
    try {
      await db.batch([
        db.insert(schema.users).values({
          id: userId,
          publicId,
          status: "unclaimed",
          placeholderName: entry.name,
          unclaimedAt: now,
        }),
        db.insert(schema.userEmails).values({
          id: `uem_${uuidv7()}`,
          userId,
          email: entry.email,
          isPrimary: true,
          verifiedAt: null,
        }),
        buildAuditEventStatement({
          actorUserId: approverUserId,
          action: "member.pre_added",
          targetUserId: userId,
          metadata: { email: entry.email, placeholderName: entry.name },
        }),
      ]);
      created.push({
        userId,
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

  return { ok: true, created, skipped };
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
  const approver = await requireMembersManager();
  const db = getDb();

  const newName = args.name.trim();
  const newEmail = normalizeEmail(args.email);

  // Load both source rows in parallel — one round-trip-equivalent on D1
  // and we only need a snapshot for the not-found / not-unclaimed guards
  // and the audit metadata's `before` value. The actual race-safety
  // boundary is the `status = 'unclaimed'` filter on each UPDATE below
  // (and the UNIQUE(email) constraint for the email change).
  const [userRow, emailRow] = await Promise.all([
    db
      .select({
        status: schema.users.status,
        placeholderName: schema.users.placeholderName,
      })
      .from(schema.users)
      .where(eq(schema.users.id, args.userId))
      .get(),
    db
      .select({ id: schema.userEmails.id, email: schema.userEmails.email })
      .from(schema.userEmails)
      .where(
        and(
          eq(schema.userEmails.userId, args.userId),
          eq(schema.userEmails.isPrimary, true),
        ),
      )
      .get(),
  ]);
  if (!userRow) {
    return { ok: false, error: { kind: "not_found" } };
  }
  if (userRow.status !== "unclaimed") {
    return { ok: false, error: { kind: "not_unclaimed" } };
  }
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

  // Always include the user UPDATE in the batch (even when only email
  // changed, the SET is then a no-op self-assign). Two reasons:
  //   1. `.returning({ id })` gives us atomic race-no-op detection —
  //      if a concurrent claim flipped the status mid-flight, the
  //      WHERE filters out and `.returning()` is empty.
  //   2. The audit insert below rides in the same batch and is
  //      atomic with the UPDATEs (a worker death between them is
  //      impossible), which would not be true if we kept the audit
  //      as a post-batch `recordAuditEvent` call.
  //
  // Trade-off: in the rare race-no-op case (concurrent claim flips
  // status between our pre-SELECT and the batch), the audit row
  // *does* land while the UPDATEs no-op. That's a phantom row
  // recording an officer's edit *attempt* on a row that's no longer
  // unclaimed. We accept this trade-off in exchange for atomicity:
  // the alternatives are (a) post-batch audit (worker-death window)
  // or (b) `INSERT ... SELECT WHERE EXISTS` via raw SQL, which the
  // d1 batch driver doesn't accept (`db.run(sql\`…\`)` returns a
  // non-batchable shape). A phantom audit recording attempted intent
  // is a defensible audit-log entry; a freshly-edited row with no
  // audit at all is not.
  type Stmt = Parameters<typeof db.batch>[0][number];
  const stmts: Stmt[] = [];

  const userUpdate = db
    .update(schema.users)
    .set({ placeholderName: newName })
    .where(
      and(
        eq(schema.users.id, args.userId),
        eq(schema.users.status, "unclaimed"),
      ),
    )
    .returning({ id: schema.users.id });
  stmts.push(userUpdate);

  if (before.email !== newEmail) {
    stmts.push(
      db
        .update(schema.userEmails)
        .set({ email: newEmail })
        .where(
          and(
            eq(schema.userEmails.id, emailRow.id),
            exists(
              db
                .select({ one: schema.users.id })
                .from(schema.users)
                .where(
                  and(
                    eq(schema.users.id, args.userId),
                    eq(schema.users.status, "unclaimed"),
                  ),
                ),
            ),
          ),
        ),
    );
  }

  stmts.push(
    buildAuditEventStatement({
      actorUserId: approver.userId,
      action: "member.unclaimed_edited",
      targetUserId: args.userId,
      metadata: {
        before,
        after: { name: newName, email: newEmail },
      },
    }),
  );

  let userUpdated: Array<{ id: string }>;
  try {
    const results = await db.batch(stmts as [Stmt, ...Stmt[]]);
    userUpdated = results[0];
  } catch (err) {
    if (isUniqueViolation(err, "user_emails.email")) {
      return { ok: false, error: { kind: "email_taken" } };
    }
    throw err;
  }

  // `.returning()` from the user UPDATE tells us atomically whether
  // the row was still unclaimed at batch-execute time. Empty array
  // means a concurrent claim/delete won the race.
  if (userUpdated.length === 0) {
    return { ok: false, error: { kind: "not_unclaimed" } };
  }

  return { ok: true };
}

// ── delete (bulk) ───────────────────────────────────────────────────────

export interface DeleteUnclaimedResult {
  deletedIds: string[];
}

export async function deleteUnclaimedMembersAction(args: {
  userIds: string[];
}): Promise<DeleteUnclaimedResult> {
  const approver = await requireMembersManager();
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
