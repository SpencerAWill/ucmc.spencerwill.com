/**
 * Data access for conduct records. No auth and no business rules: every
 * function takes what it needs as arguments, and the actions decide who
 * may call it.
 *
 * Every read that a viewer drives takes `viewerUserId` and leaves out
 * the records whose subject is that viewer. An exec member must never
 * read their own file (the user's decision; see the design doc), and
 * filtering here rather than in each action means no read can forget.
 */
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type {
  ConductLevel,
  ConductReportStatus,
  ScocState,
} from "#/../drizzle/schema";
import type { AuditEventInput } from "#/server/audit/audit-log.server";
import { buildConditionalAuditEventStatement } from "#/server/audit/audit-log.server";
import { CLUB_TIME_ZONE } from "#/config/time";
import { getDb, inJsonArray, insertStatements, schema } from "#/server/db";
import { PROFILE_NAME_SEARCH, searchMatches } from "#/server/db/search";

type RecordInsert = typeof schema.conductRecords.$inferInsert;

const records = schema.conductRecords;

function notSubject(viewerUserId: string): SQL {
  return sql`(${records.subjectUserId} is null or ${records.subjectUserId} <> ${viewerUserId})`;
}

/** The name a record snapshots, or null when the user does not exist. */
export async function findSubjectName(
  userId: string,
): Promise<{ name: string } | null> {
  const rows = await getDb()
    .select({
      fullName: schema.profiles.fullName,
      placeholderName: schema.users.placeholderName,
    })
    .from(schema.users)
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .where(eq(schema.users.id, userId))
    .limit(1);
  const row = rows.at(0);
  if (!row) {
    return null;
  }
  // A pre-added member who never claimed the account has no profile;
  // the officer's placeholder name is the only name there is.
  return { name: row.fullName ?? row.placeholderName ?? "Unnamed member" };
}

export interface ConductSubjectOption {
  userId: string;
  publicId: string;
  fullName: string;
}

/**
 * Approved members whose name contains `query`, for the record form's
 * subject picker. The viewer is left out: nobody opens a record on
 * themselves.
 */
export async function searchSubjects(
  query: string,
  viewerUserId: string,
  limit = 20,
): Promise<ConductSubjectOption[]> {
  return getDb()
    .select({
      userId: schema.users.id,
      publicId: schema.users.publicId,
      fullName: schema.profiles.fullName,
    })
    .from(schema.users)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .where(
      and(
        eq(schema.users.status, "approved"),
        ne(schema.users.id, viewerUserId),
        searchMatches(schema.users.id, PROFILE_NAME_SEARCH, "user_id", query, [
          "full_name",
        ]),
      ),
    )
    .orderBy(asc(schema.profiles.fullName))
    .limit(limit);
}

/**
 * One approved member by public id, in the picker's shape, or null.
 * The viewer is left out, as in `searchSubjects`.
 */
export async function findSubject(
  publicId: string,
  viewerUserId: string,
): Promise<ConductSubjectOption | null> {
  const rows = await getDb()
    .select({
      userId: schema.users.id,
      publicId: schema.users.publicId,
      fullName: schema.profiles.fullName,
    })
    .from(schema.users)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .where(
      and(
        eq(schema.users.publicId, publicId),
        eq(schema.users.status, "approved"),
        ne(schema.users.id, viewerUserId),
      ),
    )
    .limit(1);
  return rows.at(0) ?? null;
}

export interface LinkableReport {
  id: string;
  publicId: string;
  status: ConductReportStatus;
  possibleScoc: boolean;
  /** Linked to a record that is referred to SCCS right now. */
  locked: boolean;
  /** Linked to a record SCCS has already returned or sanctioned. */
  sccsDone: boolean;
}

// The outer column is written out qualified: in a one-table select
// Drizzle renders `${schema.conductReports.id}` as a bare "id", which
// inside the subquery would bind to `r.id` instead.
function linkedRecordInState(states: readonly string[]): SQL<number> {
  return sql<number>`exists (select 1 from ${schema.conductRecordReports} crr join ${records} r on r.id = crr.record_id where crr.report_id = "conduct_reports"."id" and ${inJsonArray(sql`r.scoc_state`, states)})`;
}

/**
 * The reports a record about `subjectUserId` may cite: those about the
 * same member, or about someone the reporter could not name. A report
 * about anyone else is left out, so the caller's count check refuses it.
 */
export async function findReportsByPublicId(
  publicIds: readonly string[],
  subjectUserId: string,
): Promise<LinkableReport[]> {
  if (publicIds.length === 0) {
    return [];
  }
  const rows = await getDb()
    .select({
      id: schema.conductReports.id,
      publicId: schema.conductReports.publicId,
      status: schema.conductReports.status,
      possibleScoc: schema.conductReports.possibleScoc,
      locked: linkedRecordInState(["referred"]),
      sccsDone: linkedRecordInState(["returned", "sccs_sanctioned"]),
    })
    .from(schema.conductReports)
    .where(
      and(
        inJsonArray(schema.conductReports.publicId, publicIds),
        or(
          isNull(schema.conductReports.subjectUserId),
          eq(schema.conductReports.subjectUserId, subjectUserId),
        ),
      ),
    );
  return rows.map((r) => ({
    ...r,
    locked: Boolean(r.locked),
    sccsDone: Boolean(r.sccsDone),
  }));
}

/** The internal id of a warning on `subjectUserId`, lifted or not. */
export async function findWarningId(
  publicId: string,
  subjectUserId: string,
): Promise<string | null> {
  const rows = await getDb()
    .select({ id: records.id })
    .from(records)
    .where(
      and(
        eq(records.publicId, publicId),
        eq(records.level, "warning"),
        eq(records.subjectUserId, subjectUserId),
      ),
    )
    .limit(1);
  return rows.at(0)?.id ?? null;
}

/** What a mutation needs to know about a record. Server-side only. */
export interface RecordForMutation {
  id: string;
  publicId: string;
  level: ConductLevel;
  /** `null` once the subject's account is gone. */
  subjectUserId: string | null;
  endsOn: Temporal.PlainDate | null;
  liftedAt: Temporal.Instant | null;
  scocState: ScocState;
  noticeSentAt: Temporal.Instant | null;
  /** A later record already corrects this one. */
  superseded: boolean;
}

// Qualified against the outer, unaliased `conduct_records`.
const IS_SUPERSEDED = sql<number>`exists (select 1 from "conduct_records" "superseder" where "superseder"."supersedes_id" = "conduct_records"."id")`;

export async function findRecordForMutation(
  publicId: string,
  viewerUserId: string,
): Promise<RecordForMutation | null> {
  const rows = await getDb()
    .select({
      id: records.id,
      publicId: records.publicId,
      level: records.level,
      subjectUserId: records.subjectUserId,
      endsOn: records.endsOn,
      liftedAt: records.liftedAt,
      scocState: records.scocState,
      noticeSentAt: records.noticeSentAt,
      superseded: IS_SUPERSEDED,
    })
    .from(records)
    .where(and(eq(records.publicId, publicId), notSubject(viewerUserId)))
    .limit(1);
  const row = rows.at(0);
  return row ? { ...row, superseded: Boolean(row.superseded) } : null;
}

const prior = alias(records, "prior_warning");
const superseded = alias(records, "superseded");
const creator = alias(schema.profiles, "creator_profile");
const referrer = alias(schema.profiles, "referrer_profile");
const lifter = alias(schema.profiles, "lifter_profile");

/**
 * A record as the detail page shows it. Projected column by column so
 * no internal id reaches the client: other records and the subject are
 * named by public id, and officers by their preferred name.
 */
export async function findRecordDetail(publicId: string, viewerUserId: string) {
  const rows = await getDb()
    .select({
      publicId: records.publicId,
      level: records.level,
      subjectName: records.subjectNameSnapshot,
      subjectPublicId: schema.users.publicId,
      memberStatement: records.memberStatement,
      internalNotes: records.internalNotes,
      startsOn: records.startsOn,
      endsOn: records.endsOn,
      scocState: records.scocState,
      referredOn: records.referredOn,
      referredByName: referrer.preferredName,
      sccsOutcomeNote: records.sccsOutcomeNote,
      voteHeldOn: records.voteHeldOn,
      votesFor: records.votesFor,
      votesAgainst: records.votesAgainst,
      votesAbstain: records.votesAbstain,
      committeeSize: records.committeeSize,
      priorWarningPublicId: prior.publicId,
      warningSkipped: records.warningSkipped,
      supersedesPublicId: superseded.publicId,
      supersededByPublicId: sql<
        string | null
      >`(select "superseder"."public_id" from "conduct_records" "superseder" where "superseder"."supersedes_id" = "conduct_records"."id" limit 1)`,
      liftedAt: records.liftedAt,
      liftedByName: lifter.preferredName,
      liftReason: records.liftReason,
      appealOutcome: records.appealOutcome,
      noticeSentAt: records.noticeSentAt,
      createdByName: creator.preferredName,
      createdAt: records.createdAt,
      updatedAt: records.updatedAt,
      retainUntil: records.retainUntil,
    })
    .from(records)
    .leftJoin(schema.users, eq(schema.users.id, records.subjectUserId))
    .leftJoin(prior, eq(prior.id, records.priorWarningId))
    .leftJoin(superseded, eq(superseded.id, records.supersedesId))
    .leftJoin(creator, eq(creator.userId, records.createdBy))
    .leftJoin(referrer, eq(referrer.userId, records.referredBy))
    .leftJoin(lifter, eq(lifter.userId, records.liftedBy))
    .where(and(eq(records.publicId, publicId), notSubject(viewerUserId)))
    .limit(1);
  return rows.at(0) ?? null;
}

/**
 * What the record form needs to prefill a correction of `publicId`: the
 * member in the picker's shape (any status, since a terminated member is
 * deactivated) and the member-facing fields. Null when the viewer may not
 * read it or the member's account is gone.
 */
export async function findCorrectionDraft(
  publicId: string,
  viewerUserId: string,
) {
  const rows = await getDb()
    .select({
      userId: schema.users.id,
      subjectPublicId: schema.users.publicId,
      subjectName: records.subjectNameSnapshot,
      level: records.level,
      memberStatement: records.memberStatement,
      startsOn: records.startsOn,
      endsOn: records.endsOn,
      voteHeldOn: records.voteHeldOn,
      votesFor: records.votesFor,
      votesAgainst: records.votesAgainst,
      votesAbstain: records.votesAbstain,
      committeeSize: records.committeeSize,
      priorWarningPublicId: prior.publicId,
      warningSkipped: records.warningSkipped,
    })
    .from(records)
    .innerJoin(schema.users, eq(schema.users.id, records.subjectUserId))
    .leftJoin(prior, eq(prior.id, records.priorWarningId))
    .where(and(eq(records.publicId, publicId), notSubject(viewerUserId)))
    .limit(1);
  return rows.at(0) ?? null;
}

export type ConductRecordDetailRow = NonNullable<
  Awaited<ReturnType<typeof findRecordDetail>>
>;

export interface RecordListFilter {
  level?: ConductLevel;
  /** In force: unlifted, and `ends_on` NULL or not past (Ruling 27). */
  active?: boolean;
  lifted?: boolean;
  referred?: boolean;
}

export async function listRecords(
  filter: RecordListFilter,
  viewerUserId: string,
  today: Temporal.PlainDate = Temporal.Now.plainDateISO(CLUB_TIME_ZONE),
) {
  const conditions: SQL[] = [notSubject(viewerUserId)];
  if (filter.level !== undefined) {
    conditions.push(eq(records.level, filter.level));
  }
  if (filter.active !== undefined) {
    // Text dates compare as strings. An upcoming record is in force.
    const inForce = sql`(${records.liftedAt} is null and (${records.endsOn} is null or ${records.endsOn} >= ${today.toString()}))`;
    conditions.push(filter.active ? inForce : sql`not ${inForce}`);
  }
  if (filter.lifted !== undefined) {
    conditions.push(
      filter.lifted ? isNotNull(records.liftedAt) : isNull(records.liftedAt),
    );
  }
  if (filter.referred !== undefined) {
    conditions.push(
      filter.referred
        ? eq(records.scocState, "referred")
        : ne(records.scocState, "referred"),
    );
  }
  return getDb()
    .select({
      publicId: records.publicId,
      level: records.level,
      subjectName: records.subjectNameSnapshot,
      subjectPublicId: schema.users.publicId,
      startsOn: records.startsOn,
      endsOn: records.endsOn,
      scocState: records.scocState,
      liftedAt: records.liftedAt,
      noticeSentAt: records.noticeSentAt,
      createdAt: records.createdAt,
    })
    .from(records)
    .leftJoin(schema.users, eq(schema.users.id, records.subjectUserId))
    .where(and(...conditions))
    .orderBy(desc(records.createdAt), desc(records.id));
}

/** A member's records, newest first. The caller excludes the viewer. */
export async function listRecordsForSubject(subjectUserId: string) {
  return getDb()
    .select({
      publicId: records.publicId,
      level: records.level,
      startsOn: records.startsOn,
      liftedAt: records.liftedAt,
    })
    .from(records)
    .where(eq(records.subjectUserId, subjectUserId))
    .orderBy(desc(records.createdAt), desc(records.id));
}

/** Audit rows for one record, oldest first. `targetId` is its public id. */
export async function listRecordHistory(publicId: string) {
  return getDb()
    .select({
      id: schema.auditLog.id,
      action: schema.auditLog.action,
      actorName: schema.profiles.preferredName,
      metadataJson: schema.auditLog.metadataJson,
      createdAt: schema.auditLog.createdAt,
    })
    .from(schema.auditLog)
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.auditLog.actorUserId),
    )
    .where(
      and(
        eq(schema.auditLog.targetType, "conduct_record"),
        eq(schema.auditLog.targetId, publicId),
      ),
    )
    .orderBy(asc(schema.auditLog.createdAt), asc(schema.auditLog.id));
}

// ── statements, for the caller's batch ────────────────────────────────

/**
 * `supersedesId` may be `supersedesReference(...)`, which aborts the
 * whole batch when the record being corrected changed after it was read.
 */
export function insertRecordStatement(
  row: Omit<RecordInsert, "supersedesId"> & {
    supersedesId: string | SQL | null;
  },
) {
  return getDb().insert(records).values(row);
}

/**
 * The state a record being corrected must still be in: not referred, not
 * already corrected and, when it was unlifted as read, still unlifted.
 * Written against the unaliased `conduct_records`.
 */
function correctableState(recordId: string, requireUnlifted: boolean): SQL {
  return sql`"conduct_records"."id" = ${recordId} and "conduct_records"."scoc_state" <> 'referred' and not exists (select 1 from "conduct_records" "superseder" where "superseder"."supersedes_id" = ${recordId})${requireUnlifted ? sql` and "conduct_records"."lifted_at" is null` : sql``}`;
}

/**
 * The new record's `supersedes_id`, guarded. While the old record is as
 * the action read it this is its id. Once it is not (a lift or another
 * correction landed first) it is a value no record has, so the FK fails
 * and D1 rolls back the whole batch: nothing of the correction is
 * written. `isForeignKeyViolation` recognises the error.
 */
export function supersedesReference(
  recordId: string,
  requireUnlifted: boolean,
): SQL {
  return sql`coalesce((select "conduct_records"."id" from "conduct_records" where ${correctableState(recordId, requireUnlifted)}), 'conduct-correction-lost-race')`;
}

/**
 * What a correction does to the record it supersedes, for the caller's
 * batch, after the new record's insert. A termination replacing an active
 * one first carries the old block over, so an address the member has
 * since removed stays blocked. Then, when the old record is unlifted, it
 * is lifted with its audit row and its block dropped, each guarded as in
 * `applyRecordWrite`.
 */
export function supersedeRecordStatements(input: {
  oldRecordId: string;
  newRecordId: string;
  carryBlockedEmails: boolean;
  lift: { set: Partial<RecordInsert>; audit: AuditEventInput } | null;
}) {
  const db = getDb();
  const carry = input.carryBlockedEmails
    ? [
        db
          .insert(schema.conductBlockedEmails)
          .select(
            sql`select ${input.newRecordId}, "email_hmac" from "conduct_blocked_emails" where "record_id" = ${input.oldRecordId}`,
          )
          .onConflictDoNothing(),
      ]
    : [];
  if (input.lift === null) {
    return carry;
  }
  const unlifted = REQUIRED_STATE.unlifted;
  const stillApplies = sql`exists (select 1 from "conduct_records" where "conduct_records"."id" = ${input.oldRecordId} and ${unlifted})`;
  return [
    ...carry,
    buildConditionalAuditEventStatement(input.lift.audit, stillApplies),
    db
      .delete(schema.conductBlockedEmails)
      .where(
        and(
          eq(schema.conductBlockedEmails.recordId, input.oldRecordId),
          stillApplies,
        ),
      ),
    db
      .update(records)
      .set(input.lift.set)
      .where(and(eq(records.id, input.oldRecordId), unlifted)),
  ];
}

export function linkReportsStatements(recordId: string, reportIds: string[]) {
  return insertStatements(
    schema.conductRecordReports,
    reportIds.map((reportId) => ({ recordId, reportId })),
  );
}

/**
 * The state a record must still be in for a write to apply. Written
 * qualified, because the same fragment runs inside the UPDATE and inside
 * the `exists` subqueries that guard the write's side effects.
 */
const REQUIRED_STATE = {
  any: sql`1`,
  unreferred: sql`"conduct_records"."scoc_state" = 'none'`,
  referred: sql`"conduct_records"."scoc_state" = 'referred'`,
  unlifted: sql`"conduct_records"."lifted_at" is null`,
} as const;

export type RequiredRecordState = keyof typeof REQUIRED_STATE;

/**
 * Apply one write to a record, with its audit row, as one batch, and
 * report whether it applied.
 *
 * The guard is the record still being in `requires`. A request that
 * lost a race to an identical one (two lifts, two referrals) must not
 * leave a second audit row or rerun a side effect, so every statement
 * carries the guard: the audit insert and any delete run first and
 * check it through `exists`, then the UPDATE checks it itself. The batch
 * is one transaction, so all of them see the same answer. When it is
 * false nothing is written and this returns `false` for the caller to
 * throw.
 */
export async function applyRecordWrite(input: {
  recordId: string;
  requires: RequiredRecordState;
  set: Partial<RecordInsert>;
  audit: AuditEventInput;
  /** A lifted termination no longer blocks the member's addresses. */
  deleteBlockedEmails?: boolean;
}): Promise<boolean> {
  const state = REQUIRED_STATE[input.requires];
  const stillApplies = sql`exists (select 1 from "conduct_records" where "conduct_records"."id" = ${input.recordId} and ${state})`;
  const db = getDb();
  const update = db
    .update(records)
    .set(input.set)
    .where(and(eq(records.id, input.recordId), state))
    .returning({ id: records.id });
  const audit = buildConditionalAuditEventStatement(input.audit, stillApplies);
  const results = input.deleteBlockedEmails
    ? await db.batch([
        audit,
        db
          .delete(schema.conductBlockedEmails)
          .where(
            and(
              eq(schema.conductBlockedEmails.recordId, input.recordId),
              stillApplies,
            ),
          ),
        update,
      ])
    : await db.batch([audit, update]);
  const updated = results[results.length - 1];
  return Array.isArray(updated) && updated.length > 0;
}

/**
 * Every address on the account, verified or not: a termination blocks
 * all of them (the primary is a `user_emails` row like the rest).
 */
export async function findAccountEmails(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ email: schema.userEmails.email })
    .from(schema.userEmails)
    .where(eq(schema.userEmails.userId, userId));
  return rows.map((r) => r.email);
}

/** One `conduct_blocked_emails` row per fingerprint, split to fit D1. */
export function blockEmailsStatements(recordId: string, emailHmacs: string[]) {
  return insertStatements(
    schema.conductBlockedEmails,
    [...new Set(emailHmacs)].map((emailHmac) => ({ recordId, emailHmac })),
  );
}

/** The subject's primary verified address, or null when they have none. */
export async function findNoticeRecipient(
  userId: string,
): Promise<string | null> {
  const rows = await getDb()
    .select({ email: schema.userEmails.email })
    .from(schema.userEmails)
    .where(
      and(
        eq(schema.userEmails.userId, userId),
        eq(schema.userEmails.isPrimary, true),
        isNotNull(schema.userEmails.verifiedAt),
      ),
    )
    .limit(1);
  return rows.at(0)?.email ?? null;
}

/** Record that the notice went out. Only ever set once. */
export async function markNoticeSent(
  recordId: string,
  at: Temporal.Instant,
): Promise<void> {
  await getDb()
    .update(records)
    .set({ noticeSentAt: at })
    .where(and(eq(records.id, recordId), isNull(records.noticeSentAt)));
}

/**
 * A member's own warnings, suspensions and terminations that are not
 * lifted and have not run out. Statement and dates only: nothing internal.
 * A termination has no end date, so it holds until lifted.
 */
export async function listActiveSanctionsFor(
  subjectUserId: string,
  today: Temporal.PlainDate,
) {
  const day = today.toString();
  return getDb()
    .select({
      level: records.level,
      statement: records.memberStatement,
      startsOn: records.startsOn,
      endsOn: records.endsOn,
    })
    .from(records)
    .where(
      and(
        eq(records.subjectUserId, subjectUserId),
        isNull(records.liftedAt),
        or(
          eq(records.level, "termination"),
          and(
            or(eq(records.level, "warning"), eq(records.level, "suspension")),
            or(isNull(records.endsOn), sql`${records.endsOn} >= ${day}`),
          ),
        ),
      ),
    )
    .orderBy(desc(records.createdAt), desc(records.id));
}

/**
 * The statement of a member's newest unlifted termination, or null. For
 * the member's own `/deactivated` page, so it reads by subject with no
 * viewer filter: the subject is the viewer.
 */
export async function findActiveTerminationStatementFor(
  subjectUserId: string,
): Promise<string | null> {
  const rows = await getDb()
    .select({ statement: records.memberStatement })
    .from(records)
    .where(
      and(
        eq(records.subjectUserId, subjectUserId),
        eq(records.level, "termination"),
        isNull(records.liftedAt),
      ),
    )
    .orderBy(desc(records.createdAt), desc(records.id))
    .limit(1);
  return rows.at(0)?.statement ?? null;
}

/**
 * The statement of the newest unlifted termination that blocked this
 * fingerprint, or null. Holds after the account is purged, because the
 * fingerprint outlives it.
 */
export async function findActiveTerminationStatementByFingerprint(
  emailHmac: string,
): Promise<string | null> {
  const rows = await getDb()
    .select({ statement: records.memberStatement })
    .from(schema.conductBlockedEmails)
    .innerJoin(records, eq(records.id, schema.conductBlockedEmails.recordId))
    .where(
      and(
        eq(schema.conductBlockedEmails.emailHmac, emailHmac),
        eq(records.level, "termination"),
        isNull(records.liftedAt),
      ),
    )
    .orderBy(desc(records.createdAt), desc(records.id))
    .limit(1);
  return rows.at(0)?.statement ?? null;
}
