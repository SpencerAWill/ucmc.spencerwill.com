/**
 * Conduct record actions. The shells in `./record-fns.ts` dynamic-import
 * this module; tests call it directly.
 *
 * Rules every action here keeps:
 *
 *   - **A viewer never reads their own file.** Records whose subject is
 *     the caller are filtered out in the repo, so `get` answers `null`,
 *     `list` leaves them out and a mutation on one is "Record not found".
 *   - **The SCOC lock.** While a record is referred to SCCS, nothing above
 *     a note may be issued that cites any of its reports, and nothing
 *     above a note may be created as a possible SCOC violation at all.
 *     Both throw "Referred to SCCS". A report the reporter flagged as
 *     possible SCOC forces a new note to `referred`, until a record citing
 *     it has an SCCS outcome.
 *   - **One batch per mutation**, holding the write and its audit row.
 *     Audit rows target `('conduct_record', publicId)` and their metadata
 *     carries the level, the state transition and ids only. A lifecycle
 *     write whose guard no longer holds (it lost a race) writes nothing,
 *     audit row included, and throws.
 *   - **`retain_until` is recomputed by every write**, with `updated_at`
 *     as the last activity.
 */
import { uuidv7 } from "uuidv7";

import type { ConductLevel, ScocState } from "#/../drizzle/schema";
import { conductLevel } from "#/../drizzle/schema";
import { CLUB_TIME_ZONE } from "#/config/time";
import {
  requireConductManager,
  requireConductViewer,
} from "#/features/conduct/server/conduct-guards.server";
import type {
  CreateRecordArgs,
  LiftArgs,
  ListRecordsFilter,
  ReferArgs,
  SccsOutcomeArgs,
  UpdateRecordArgs,
} from "#/features/conduct/server/limits";
import {
  applyRecordWrite,
  findRecordDetail,
  findRecordForMutation,
  findReportsByPublicId,
  findSubjectName,
  findWarningId,
  insertRecordStatement,
  linkReportsStatements,
  listRecordHistory,
  listRecords,
  listRecordsForSubject,
  findSubject,
  searchSubjects,
} from "#/features/conduct/server/record-repo.server";
import type {
  ConductRecordDetailRow,
  ConductSubjectOption,
  RecordForMutation,
  RequiredRecordState,
} from "#/features/conduct/server/record-repo.server";
import {
  acceptCitedReportsStatements,
  listReportsForRecord,
} from "#/features/conduct/server/report-repo.server";
import type { ConductReportSummary } from "#/features/conduct/server/report-repo.server";
import { buildAuditEventStatement } from "#/server/audit/audit-log.server";
import type { AuditAction } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { retainUntil } from "#/server/conduct/retention";
import { standingFor } from "#/server/conduct/standing.server";
import type { ConductStanding } from "#/server/conduct/standing.server";
import { runBatch } from "#/server/db";

// ── public types ────────────────────────────────────────────────────────

export interface ConductRecordSummary {
  publicId: string;
  level: ConductLevel;
  subjectName: string;
  /** `null` once the subject's account is gone. */
  subjectPublicId: string | null;
  startsOn: Temporal.PlainDate | null;
  endsOn: Temporal.PlainDate | null;
  scocState: ScocState;
  liftedAt: Temporal.Instant | null;
  createdAt: Temporal.Instant;
}

export interface AuditRow {
  id: string;
  action: AuditAction;
  actorName: string | null;
  metadataJson: string | null;
  createdAt: Temporal.Instant;
}

/** No internal ids: records and the subject by public id, officers by name. */
export type ConductRecordDetail = ConductRecordDetailRow & {
  reports: ConductReportSummary[];
  history: AuditRow[];
};

export interface MemberConductSummary {
  counts: Record<ConductLevel, number>;
  /** Without `activeRecordIds`: internal ids stay on the server. */
  standing: Pick<ConductStanding, "terminated" | "suspendedUntil">;
  records: Array<{
    publicId: string;
    level: ConductLevel;
    startsOn: Temporal.PlainDate | null;
    liftedAt: Temporal.Instant | null;
  }>;
}

// ── helpers ─────────────────────────────────────────────────────────────

const TARGET_TYPE = "conduct_record";

function today(): Temporal.PlainDate {
  return Temporal.Now.plainDateISO(CLUB_TIME_ZONE);
}

function auditEvent(
  actorUserId: string,
  action: AuditAction,
  publicId: string,
  metadata: Record<string, unknown>,
) {
  return {
    actorUserId,
    action,
    targetType: TARGET_TYPE,
    targetId: publicId,
    metadata,
  };
}

function retentionFor(
  record: Pick<RecordForMutation, "level" | "endsOn" | "liftedAt">,
  lastActivity: Temporal.Instant,
): Temporal.Instant | null {
  return retainUntil({
    kind: "record",
    level: record.level,
    endsOn: record.endsOn,
    liftedAt: record.liftedAt,
    lastActivity,
  });
}

async function loadForMutation(
  publicId: string,
  viewerUserId: string,
): Promise<RecordForMutation> {
  const record = await findRecordForMutation(publicId, viewerUserId);
  if (!record) {
    throw new Error("Record not found");
  }
  return record;
}

// ── reads ───────────────────────────────────────────────────────────────

export async function listConductRecordsAction(
  filter: ListRecordsFilter,
): Promise<ConductRecordSummary[]> {
  const principal = await requireConductViewer();
  return listRecords(filter, principal.userId);
}

export async function getConductRecordAction(
  publicId: string,
): Promise<ConductRecordDetail | null> {
  const principal = await requireConductViewer();
  const record = await findRecordDetail(publicId, principal.userId);
  if (!record) {
    return null;
  }
  return {
    ...record,
    reports: await listReportsForRecord(record.publicId, principal.userId),
    history: await listRecordHistory(record.publicId),
  };
}

export async function memberConductSummaryAction(
  userId: string,
): Promise<MemberConductSummary | null> {
  const principal = await loadCurrentPrincipal();
  if (
    !principal ||
    !principal.permissions.includes("conduct:view") ||
    principal.userId === userId
  ) {
    return null;
  }
  const records = await listRecordsForSubject(userId);
  const counts = Object.fromEntries(
    conductLevel.map((level) => [
      level,
      records.filter((r) => r.level === level).length,
    ]),
  ) as Record<ConductLevel, number>;
  const { terminated, suspendedUntil } = await standingFor(userId);
  return { counts, standing: { terminated, suspendedUntil }, records };
}

/** Name search behind the record form's subject picker. */
export async function searchConductSubjectsAction(input: {
  q: string;
}): Promise<ConductSubjectOption[]> {
  const principal = await requireConductManager();
  const q = input.q.trim();
  if (q.length === 0) {
    return [];
  }
  return searchSubjects(q, principal.userId);
}

/** One member by public id for the record form's prefill, or null. */
export async function getConductSubjectAction(input: {
  publicId: string;
}): Promise<ConductSubjectOption | null> {
  const principal = await requireConductManager();
  return findSubject(input.publicId, principal.userId);
}

// ── create ──────────────────────────────────────────────────────────────

export async function createConductRecordAction(
  input: CreateRecordArgs,
): Promise<{ publicId: string }> {
  const principal = await requireConductManager();
  // A manager does not open a file on themselves: they could not read it
  // afterwards, and it is a conflict of interest the board resolves by
  // giving `conduct:manage` to someone else.
  if (input.subjectUserId === principal.userId) {
    throw new Error("Member not found");
  }
  const subject = await findSubjectName(input.subjectUserId);
  if (!subject) {
    throw new Error("Member not found");
  }

  const reportIds = [...new Set(input.reportIds)];
  const reports = await findReportsByPublicId(reportIds, input.subjectUserId);
  if (reports.length !== reportIds.length) {
    throw new Error("Report not found");
  }
  if (reports.some((r) => r.status === "dismissed")) {
    throw new Error("Report was dismissed");
  }

  // A flagged report needs referring unless SCCS has already dealt with a
  // record that cites it.
  const referral =
    input.possibleScoc || reports.some((r) => r.possibleScoc && !r.sccsDone);
  if (input.level !== "note" && (referral || reports.some((r) => r.locked))) {
    throw new Error("Referred to SCCS");
  }

  // Lifted warnings count: §9.1 asks whether a warning was given, not
  // whether it is still in force.
  const priorWarningId =
    input.level === "termination" && input.priorWarningId !== undefined
      ? await findWarningId(input.priorWarningId, input.subjectUserId)
      : null;
  if (
    input.level === "termination" &&
    input.priorWarningId !== undefined &&
    priorWarningId === null
  ) {
    throw new Error("Prior warning not found");
  }

  const now = Temporal.Now.instant();
  const id = `crec_${uuidv7()}`;
  const publicId = generatePublicId();
  const endsOn =
    input.level === "warning" || input.level === "suspension"
      ? (input.endsOn ?? null)
      : null;
  const vote = input.level === "termination" ? input.vote : null;
  const scocState: ScocState = referral ? "referred" : "none";

  await runBatch([
    insertRecordStatement({
      id,
      publicId,
      level: input.level,
      subjectUserId: input.subjectUserId,
      subjectNameSnapshot: subject.name,
      memberStatement: input.level === "note" ? null : input.memberStatement,
      internalNotes: input.internalNotes === "" ? null : input.internalNotes,
      startsOn: input.startsOn ?? today(),
      endsOn,
      scocState,
      referredOn: referral ? today() : null,
      referredBy: referral ? principal.userId : null,
      voteHeldOn: vote?.heldOn ?? null,
      votesFor: vote?.for ?? null,
      votesAgainst: vote?.against ?? null,
      votesAbstain: vote?.abstain ?? null,
      committeeSize: vote?.committeeSize ?? null,
      priorWarningId,
      warningSkipped:
        input.level === "termination" && input.warningSkipped === true,
      createdBy: principal.userId,
      createdAt: now,
      updatedAt: now,
      retainUntil: retentionFor(
        { level: input.level, endsOn, liftedAt: null },
        now,
      ),
    }),
    ...linkReportsStatements(
      id,
      reports.map((r) => r.id),
    ),
    // Citing a report is triaging it: a `new` one becomes accepted.
    ...acceptCitedReportsStatements({
      reports,
      recordPublicId: publicId,
      actorUserId: principal.userId,
      now,
      retainUntil: retainUntil({
        kind: "report",
        status: "accepted",
        lastActivity: now,
      }),
    }),
    buildAuditEventStatement(
      auditEvent(principal.userId, "conduct.record_created", publicId, {
        level: input.level,
        scocState,
        reportIds: reports.map((r) => r.publicId),
        priorWarningId:
          input.level === "termination" ? (input.priorWarningId ?? null) : null,
        warningSkipped:
          input.level === "termination" && input.warningSkipped === true,
      }),
    ),
  ]);
  return { publicId };
}

// ── lifecycle ───────────────────────────────────────────────────────────

/**
 * Apply a lifecycle write, throwing `lostRace` when the record left the
 * required state between the pre-check and the batch. In that case the
 * batch wrote nothing, audit row included.
 */
async function transition(
  record: RecordForMutation,
  requires: RequiredRecordState,
  lostRace: string,
  write: Omit<Parameters<typeof applyRecordWrite>[0], "recordId" | "requires">,
): Promise<{ ok: true }> {
  const applied = await applyRecordWrite({
    recordId: record.id,
    requires,
    ...write,
  });
  if (!applied) {
    throw new Error(lostRace);
  }
  return { ok: true };
}

export async function updateConductRecordAction(
  input: UpdateRecordArgs,
): Promise<{ ok: true }> {
  const principal = await requireConductManager();
  const record = await loadForMutation(input.recordId, principal.userId);
  const now = Temporal.Now.instant();
  return transition(record, "any", "Record not found", {
    set: {
      internalNotes: input.internalNotes === "" ? null : input.internalNotes,
      updatedAt: now,
      retainUntil: retentionFor(record, now),
    },
    audit: auditEvent(
      principal.userId,
      "conduct.record_updated",
      record.publicId,
      { level: record.level, fields: ["internalNotes"] },
    ),
  });
}

const ALREADY_REFERRED = "Already referred to SCCS";
const NOT_REFERRED = "Not referred to SCCS";
const ALREADY_LIFTED = "Record already lifted";

export async function referConductRecordAction(
  input: ReferArgs,
): Promise<{ ok: true }> {
  const principal = await requireConductManager();
  const record = await loadForMutation(input.recordId, principal.userId);
  if (record.scocState !== "none") {
    throw new Error(ALREADY_REFERRED);
  }
  const now = Temporal.Now.instant();
  return transition(record, "unreferred", ALREADY_REFERRED, {
    set: {
      scocState: "referred",
      referredOn: input.referredOn,
      referredBy: principal.userId,
      updatedAt: now,
      retainUntil: retentionFor(record, now),
    },
    audit: auditEvent(principal.userId, "conduct.referred", record.publicId, {
      level: record.level,
      from: "none",
      to: "referred",
    }),
  });
}

export async function recordSccsOutcomeAction(
  input: SccsOutcomeArgs,
): Promise<{ ok: true }> {
  const principal = await requireConductManager();
  const record = await loadForMutation(input.recordId, principal.userId);
  if (record.scocState !== "referred") {
    throw new Error(NOT_REFERRED);
  }
  const now = Temporal.Now.instant();
  return transition(record, "referred", NOT_REFERRED, {
    set: {
      scocState: input.outcome,
      sccsOutcomeNote: input.note,
      updatedAt: now,
      retainUntil: retentionFor(record, now),
    },
    audit: auditEvent(
      principal.userId,
      "conduct.sccs_outcome",
      record.publicId,
      { level: record.level, from: "referred", to: input.outcome },
    ),
  });
}

export async function liftConductRecordAction(
  input: LiftArgs,
): Promise<{ ok: true }> {
  const principal = await requireConductManager();
  const record = await loadForMutation(input.recordId, principal.userId);
  if (record.liftedAt !== null) {
    throw new Error(ALREADY_LIFTED);
  }
  const now = Temporal.Now.instant();
  return transition(record, "unlifted", ALREADY_LIFTED, {
    set: {
      liftedAt: now,
      liftedBy: principal.userId,
      liftReason: input.reason,
      appealOutcome: input.appealOutcome ?? null,
      updatedAt: now,
      retainUntil: retentionFor({ ...record, liftedAt: now }, now),
    },
    deleteBlockedEmails: true,
    audit: auditEvent(principal.userId, "conduct.lifted", record.publicId, {
      level: record.level,
    }),
  });
}
