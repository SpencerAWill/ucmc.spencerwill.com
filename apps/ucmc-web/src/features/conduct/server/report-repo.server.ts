/**
 * Data access for member-filed conduct reports. No auth and no business
 * rules: the actions decide who may call each function.
 *
 * Every read a viewer drives takes `viewerUserId` and leaves out the
 * reports whose subject is that viewer, as `record-repo.server.ts` does
 * for records: an exec member never reads a report about themselves,
 * and filtering here means no caller can forget.
 */
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { ConductReportStatus } from "#/../drizzle/schema";
import type { AuditEventInput } from "#/server/audit/audit-log.server";
import { buildConditionalAuditEventStatement } from "#/server/audit/audit-log.server";
import { SYSTEM_ADMIN_ROLE_ID } from "#/server/auth/principal.server";
import { getDb, inJsonArray, notInJsonArray, schema } from "#/server/db";

type ReportInsert = typeof schema.conductReports.$inferInsert;

const reports = schema.conductReports;
const reporterProfile = alias(schema.profiles, "reporter_profile");
const subjectProfile = alias(schema.profiles, "subject_profile");
const subjectUser = alias(schema.users, "subject_user");

/** A report as exec reads it. `id` is the report's public id. */
export interface ConductReportSummary {
  id: string;
  /** `null` once the reporter's account is gone. */
  reporterName: string | null;
  /** `null` when the reporter could not name them, or the account is gone. */
  subjectName: string | null;
  /** Lets "start a record" find the member to prefill; never an internal id. */
  subjectPublicId: string | null;
  subjectDescription: string | null;
  occurredOn: Temporal.PlainDate;
  location: string | null;
  body: string;
  possibleScoc: boolean;
  status: ConductReportStatus;
  triagedAt: Temporal.Instant | null;
  dismissReason: string | null;
}

// Qualified, so the fragment means the same thing in a one-table select
// and in a join. A report is about the viewer when it names them, or when
// it names nobody but is cited by a record about them: once triaged into
// that record, a nameless report is plainly about its subject. Two binds
// whatever the data.
function notSubject(viewerUserId: string): SQL {
  return sql`(("conduct_reports"."subject_user_id" is null or "conduct_reports"."subject_user_id" <> ${viewerUserId}) and not exists (select 1 from "conduct_record_reports" crr_viewer join "conduct_records" cr_viewer on cr_viewer."id" = crr_viewer."record_id" where crr_viewer."report_id" = "conduct_reports"."id" and cr_viewer."subject_user_id" = ${viewerUserId}))`;
}

function selectSummaries() {
  return getDb()
    .select({
      id: reports.publicId,
      reporterName: reporterProfile.fullName,
      subjectFullName: subjectProfile.fullName,
      subjectPlaceholderName: subjectUser.placeholderName,
      subjectPublicId: subjectUser.publicId,
      subjectDescription: reports.subjectDescription,
      occurredOn: reports.occurredOn,
      location: reports.location,
      body: reports.body,
      possibleScoc: reports.possibleScoc,
      status: reports.status,
      triagedAt: reports.triagedAt,
      dismissReason: reports.dismissReason,
    })
    .from(reports)
    .leftJoin(
      reporterProfile,
      eq(reporterProfile.userId, reports.reporterUserId),
    )
    .leftJoin(subjectUser, eq(subjectUser.id, reports.subjectUserId))
    .leftJoin(subjectProfile, eq(subjectProfile.userId, reports.subjectUserId));
}

type SummaryRow = Awaited<ReturnType<typeof selectSummaries>>[number];

function toSummary(row: SummaryRow): ConductReportSummary {
  const { subjectFullName, subjectPlaceholderName, ...rest } = row;
  return {
    ...rest,
    // A pre-added member who never claimed the account has no profile.
    subjectName: subjectFullName ?? subjectPlaceholderName ?? null,
  };
}

const NEW_FIRST = sql`case when "conduct_reports"."status" = 'new' then 0 else 1 end`;

/** Reports for the triage list: `new` first, then newest first. */
export async function listReports(
  status: ConductReportStatus | undefined,
  viewerUserId: string,
): Promise<ConductReportSummary[]> {
  const conditions: SQL[] = [notSubject(viewerUserId)];
  if (status !== undefined) {
    conditions.push(eq(reports.status, status));
  }
  const rows = await selectSummaries()
    .where(and(...conditions))
    .orderBy(NEW_FIRST, desc(reports.createdAt), desc(reports.id));
  return rows.map(toSummary);
}

/** The reports a record cites, oldest incident first. */
export async function listReportsForRecord(
  recordPublicId: string,
  viewerUserId: string,
): Promise<ConductReportSummary[]> {
  const rows = await selectSummaries()
    .innerJoin(
      schema.conductRecordReports,
      eq(schema.conductRecordReports.reportId, reports.id),
    )
    .innerJoin(
      schema.conductRecords,
      eq(schema.conductRecords.id, schema.conductRecordReports.recordId),
    )
    .where(
      and(
        eq(schema.conductRecords.publicId, recordPublicId),
        notSubject(viewerUserId),
      ),
    )
    .orderBy(reports.occurredOn, reports.createdAt);
  return rows.map(toSummary);
}

/**
 * The internal id of the approved member with `publicId`, or null. The
 * report form names its subject by public id: internal ids never reach a
 * member's browser.
 */
export async function findApprovedMemberId(
  publicId: string,
): Promise<string | null> {
  const rows = await getDb()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.publicId, publicId),
        eq(schema.users.status, "approved"),
      ),
    )
    .limit(1);
  return rows.at(0)?.id ?? null;
}

/**
 * Approved holders of `conduct:manage` with a verified primary email,
 * except `excludeUserIds`. A holder is a member of a role granting the
 * permission, or of `system_admin`, which holds every permission without
 * grant rows. One row per user.
 */
export async function listConductManagerRecipients(
  excludeUserIds: readonly string[],
): Promise<Array<{ userId: string; email: string }>> {
  const db = getDb();
  const rows = await db
    .selectDistinct({
      userId: schema.users.id,
      email: schema.userEmails.email,
    })
    .from(schema.users)
    .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
    .innerJoin(
      schema.userEmails,
      and(
        eq(schema.userEmails.userId, schema.users.id),
        eq(schema.userEmails.isPrimary, true),
        isNotNull(schema.userEmails.verifiedAt),
      ),
    )
    .where(
      and(
        eq(schema.users.status, "approved"),
        notInJsonArray(schema.users.id, [...excludeUserIds]),
        or(
          eq(schema.userRoles.roleId, SYSTEM_ADMIN_ROLE_ID),
          sql`exists (select 1 from "role_permissions" inner join "permissions" on "permissions"."id" = "role_permissions"."permission_id" where "role_permissions"."role_id" = ${schema.userRoles.roleId} and "permissions"."name" = 'conduct:manage')`,
        ),
      ),
    );
  return rows;
}

/** What triage needs to know about a report. Server-side only. */
export interface ReportForTriage {
  id: string;
  publicId: string;
  subjectUserId: string | null;
  status: ConductReportStatus;
  possibleScoc: boolean;
  /** Cited by at least one record. */
  linked: boolean;
}

function isNew(reportId: string): SQL {
  return sql`exists (select 1 from "conduct_reports" where "conduct_reports"."id" = ${reportId} and "conduct_reports"."status" = 'new')`;
}

function unlinked(reportId: string): SQL {
  return sql`not exists (select 1 from "conduct_record_reports" where "conduct_record_reports"."report_id" = ${reportId})`;
}

export async function findReportForTriage(
  publicId: string,
  viewerUserId: string,
): Promise<ReportForTriage | null> {
  const rows = await getDb()
    .select({
      id: reports.id,
      publicId: reports.publicId,
      subjectUserId: reports.subjectUserId,
      status: reports.status,
      possibleScoc: reports.possibleScoc,
      linked: sql<number>`exists (select 1 from "conduct_record_reports" where "conduct_record_reports"."report_id" = "conduct_reports"."id")`,
    })
    .from(reports)
    .where(and(eq(reports.publicId, publicId), notSubject(viewerUserId)))
    .limit(1);
  const row = rows.at(0);
  return row ? { ...row, linked: Boolean(row.linked) } : null;
}

// ── statements, for the caller's batch ────────────────────────────────

export function insertReportStatement(row: ReportInsert) {
  return getDb().insert(reports).values(row);
}

/**
 * Accept the `new` reports among those a record is created citing: a
 * cited report has been triaged, by the act of citing it. One guarded
 * audit row per report, then one UPDATE over the list as a single JSON
 * parameter. A report already accepted is left as it is and gets no
 * audit row. Empty when there is nothing cited.
 */
export function acceptCitedReportsStatements(input: {
  reports: ReadonlyArray<{ id: string; publicId: string }>;
  recordPublicId: string;
  actorUserId: string;
  now: Temporal.Instant;
  retainUntil: Temporal.Instant | null;
}) {
  if (input.reports.length === 0) {
    return [];
  }
  const db = getDb();
  return [
    ...input.reports.map((r) =>
      buildConditionalAuditEventStatement(
        {
          actorUserId: input.actorUserId,
          action: "conduct.report_triaged",
          targetType: "conduct_report",
          targetId: r.publicId,
          metadata: {
            from: "new",
            to: "accepted",
            recordId: input.recordPublicId,
          },
        },
        isNew(r.id),
      ),
    ),
    db
      .update(reports)
      .set({
        status: "accepted",
        triagedBy: input.actorUserId,
        triagedAt: input.now,
        retainUntil: input.retainUntil,
      })
      .where(
        and(
          inJsonArray(
            reports.id,
            input.reports.map((r) => r.id),
          ),
          eq(reports.status, "new"),
        ),
      ),
  ];
}

/**
 * Triage one report, with its audit row and an optional link to a
 * record, as one batch, and report whether it applied.
 *
 * The guard is the report still being `new` (and, with `requireUnlinked`,
 * cited by no record). Every statement carries it: the audit insert and
 * the link run first and check it through `exists`, then the UPDATE
 * checks it itself, so a triage that lost a race to another writes
 * nothing at all and this returns `false`.
 */
export async function applyReportTriage(input: {
  reportId: string;
  set: Pick<
    ReportInsert,
    "status" | "triagedBy" | "triagedAt" | "dismissReason" | "retainUntil"
  >;
  audit: AuditEventInput;
  linkRecordId?: string;
  requireUnlinked?: boolean;
}): Promise<boolean> {
  const db = getDb();
  const extra = input.requireUnlinked ? unlinked(input.reportId) : sql`1`;
  const stillApplies = sql`${isNew(input.reportId)} and ${extra}`;
  const audit = buildConditionalAuditEventStatement(input.audit, stillApplies);
  const update = db
    .update(reports)
    .set(input.set)
    .where(
      and(eq(reports.id, input.reportId), eq(reports.status, "new"), extra),
    )
    .returning({ id: reports.id });
  const results =
    input.linkRecordId === undefined
      ? await db.batch([audit, update])
      : await db.batch([
          audit,
          // A record created with `reportIds` may already cite it.
          db
            .insert(schema.conductRecordReports)
            .select(
              sql`select ${input.linkRecordId}, ${input.reportId} where ${stillApplies}`,
            )
            .onConflictDoNothing(),
          update,
        ]);
  const updated = results[results.length - 1];
  return Array.isArray(updated) && updated.length > 0;
}
