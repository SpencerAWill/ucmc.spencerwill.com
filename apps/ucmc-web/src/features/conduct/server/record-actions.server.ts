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
 *   - **A termination blocks every address on the account**, verified or
 *     not, as `emailFingerprint` rows in the record's own batch; `lift`
 *     deletes them in its batch. Standing's `isBlockedEmail` reads them.
 *   - **`retain_until` is recomputed by every write**, with `updated_at`
 *     as the last activity.
 *   - **The notice is sent after the batch commits** (`sendNotice`), to
 *     the subject's primary verified address. It never fails the write:
 *     a missing address or a failed send is logged and leaves
 *     `notice_sent_at` NULL, which the detail page shows as "Notice not
 *     sent". `conduct.notice` is not suppressible, so no preference is
 *     read. Neither the statement nor the address goes in audit metadata.
 *   - **A termination deactivates the account** after the notice send has
 *     returned, in its own write (`deactivateUserStatements`). If that
 *     fails the record stands and the action throws `DEACTIVATION_FAILED`.
 *   - **A sent statement is corrected by superseding it.** Creating with
 *     `supersedesPublicId` lifts the old record in the same batch
 *     ("Superseded by …", its block dropped, a `conduct.lifted` audit row
 *     carrying `supersededBy`) and sends no lift notice: the new record's
 *     notice says it corrects an earlier one. If the old record changed
 *     after it was read, the batch aborts and nothing is written.
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
  PreviewNoticeArgs,
  ReferArgs,
  SccsOutcomeArgs,
  UpdateRecordArgs,
} from "#/features/conduct/server/limits";
import {
  applyRecordWrite,
  blockEmailsStatements,
  findAccountEmails,
  findRecordDetail,
  findNoticeRecipient,
  findRecordForMutation,
  findReportsByPublicId,
  findSubjectName,
  findCorrectionDraft,
  findWarningId,
  insertRecordStatement,
  linkReportsStatements,
  listRecordHistory,
  markNoticeSent,
  listRecords,
  listRecordsForSubject,
  findSubject,
  searchSubjects,
  supersedeRecordStatements,
  supersedesReference,
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
import { emailFingerprint } from "#/server/conduct/email-fingerprint.server";
import { retainUntil } from "#/server/conduct/retention";
import { isTerminated, standingFor } from "#/server/conduct/standing.server";
import type { ConductStanding } from "#/server/conduct/standing.server";
import { isForeignKeyViolation, runBatch } from "#/server/db";
import { conductNoticeEmail } from "#/server/email/conduct-email";
import type { ConductNoticeLevel } from "#/server/email/conduct-email";
import { sendEmail } from "#/server/email/resend";
import { deactivateUserStatements } from "#/server/members/deactivate.server";
import { errorMessage, log } from "#/server/log/log.server";

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

const DEACTIVATION_FAILED =
  "Record saved, but deactivating the account failed; check the member's status on /members.";

const CORRECTION_LOST_RACE =
  "The record being corrected changed; reload it and try again.";

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

/**
 * Email the subject after the write committed. Never throws. `sendEmail`
 * records the attempt itself. Only a first notice sets `notice_sent_at`
 * (which locks the statement); a lift notice leaves it alone.
 */
async function sendNotice(args: {
  recordId: string;
  subjectUserId: string | null;
  level: ConductNoticeLevel;
  lifted: boolean;
  corrects?: boolean;
  statement?: string;
  startsOn?: Temporal.PlainDate | null;
  endsOn?: Temporal.PlainDate | null;
}): Promise<void> {
  try {
    if (args.subjectUserId === null) {
      log.warn("conduct.notice_skipped", { reason: "no_account" });
      return;
    }
    const to = await findNoticeRecipient(args.subjectUserId);
    if (to === null) {
      log.warn("conduct.notice_skipped", { reason: "no_verified_email" });
      return;
    }
    await sendEmail(conductNoticeEmail({ ...args, to }));
    if (!args.lifted) {
      await markNoticeSent(args.recordId, Temporal.Now.instant());
    }
  } catch (err: unknown) {
    log.error("conduct.notice_failed", { error: errorMessage(err) });
  }
}

/** A start date the record will carry: the form's, else today. */
function noticeDates(input: {
  level: ConductLevel;
  startsOn?: Temporal.PlainDate;
  endsOn?: Temporal.PlainDate;
}) {
  return {
    startsOn: input.startsOn ?? today(),
    endsOn:
      input.level === "warning" || input.level === "suspension"
        ? (input.endsOn ?? null)
        : null,
  };
}

/**
 * Exactly what creating this record would email the member. Pure: no
 * writes, no send.
 */
export async function previewConductNoticeAction(
  input: PreviewNoticeArgs,
): Promise<{ subject: string; text: string }> {
  await requireConductManager();
  const { subject, text } = conductNoticeEmail({
    level: input.level,
    statement: input.memberStatement,
    lifted: false,
    corrects: input.supersedesPublicId !== undefined,
    ...noticeDates(input),
  });
  return { subject, text };
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

export interface CorrectionDraft {
  subject: ConductSubjectOption;
  level: Exclude<ConductLevel, "note">;
  memberStatement: string;
  startsOn: Temporal.PlainDate | null;
  endsOn: Temporal.PlainDate | null;
  vote: {
    heldOn: Temporal.PlainDate;
    for: number;
    against: number;
    abstain: number;
    committeeSize: number;
  } | null;
  priorWarningPublicId: string | null;
  warningSkipped: boolean;
}

/**
 * The record form's prefill for correcting `publicId`, or null when it
 * cannot be corrected (see `findCorrectable`) or its member's account is
 * gone. The subject may be deactivated: a terminated member is.
 */
export async function getCorrectionDraftAction(input: {
  publicId: string;
}): Promise<CorrectionDraft | null> {
  const principal = await requireConductManager();
  const record = await findRecordForMutation(input.publicId, principal.userId);
  if (!record || correctionRefusal(record) !== null) {
    return null;
  }
  const row = await findCorrectionDraft(input.publicId, principal.userId);
  if (!row || row.level === "note" || row.memberStatement === null) {
    return null;
  }
  return {
    subject: {
      userId: row.userId,
      publicId: row.subjectPublicId,
      fullName: row.subjectName,
    },
    level: row.level,
    memberStatement: row.memberStatement,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    vote:
      row.voteHeldOn !== null &&
      row.votesFor !== null &&
      row.votesAgainst !== null &&
      row.votesAbstain !== null &&
      row.committeeSize !== null
        ? {
            heldOn: row.voteHeldOn,
            for: row.votesFor,
            against: row.votesAgainst,
            abstain: row.votesAbstain,
            committeeSize: row.committeeSize,
          }
        : null,
    priorWarningPublicId: row.priorWarningPublicId,
    warningSkipped: row.warningSkipped,
  };
}

/**
 * Why `record` cannot be corrected, or null when it can. A correction
 * replaces a notice the member was sent or a sanction still in force,
 * once, and not while SCCS holds the matter.
 */
function correctionRefusal(record: RecordForMutation): string | null {
  if (record.level === "note") {
    return "A note has no notice to correct";
  }
  if (record.superseded) {
    return "Record already corrected";
  }
  if (record.scocState === "referred") {
    return "Referred to SCCS";
  }
  if (record.noticeSentAt === null && record.liftedAt !== null) {
    return "Only a sent or active record can be corrected";
  }
  return null;
}

/**
 * The record this create corrects, or null when it corrects none. It
 * must be about the same member and correctable; subject-hiding applies
 * through `findRecordForMutation`, and a mismatch reads as not found.
 */
async function findCorrectable(
  input: CreateRecordArgs,
  viewerUserId: string,
): Promise<RecordForMutation | null> {
  if (input.supersedesPublicId === undefined) {
    return null;
  }
  if (input.level === "note") {
    throw new Error(
      "A correction must be a warning, suspension or termination",
    );
  }
  const old = await findRecordForMutation(
    input.supersedesPublicId,
    viewerUserId,
  );
  if (!old || old.subjectUserId !== input.subjectUserId) {
    throw new Error("Record not found");
  }
  const refusal = correctionRefusal(old);
  if (refusal !== null) {
    throw new Error(refusal);
  }
  return old;
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
  const old = await findCorrectable(input, principal.userId);
  // One active termination per member: a second (say, a resubmit after
  // a failed deactivation) would duplicate the notice and the block. A
  // correction of that termination replaces it in the same batch, so it
  // is the one exception.
  const replacesActiveTermination =
    old !== null && old.level === "termination" && old.liftedAt === null;
  if (
    input.level === "termination" &&
    !replacesActiveTermination &&
    (await isTerminated(input.subjectUserId))
  ) {
    throw new Error("Member already has an active termination");
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
  // Computed before the batch: a missing key throws here, so a
  // termination is never written without its block.
  const blockedEmailHmacs =
    input.level === "termination"
      ? await Promise.all(
          (await findAccountEmails(input.subjectUserId)).map(emailFingerprint),
        )
      : [];

  const statements = [
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
      // Guarded: aborts the batch if the old record changed since read.
      supersedesId:
        old === null
          ? null
          : supersedesReference(old.id, old.liftedAt === null),
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
    // A termination blocks every address on the account by keyed hash.
    ...blockEmailsStatements(id, blockedEmailHmacs),
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
        supersedesId: old?.publicId ?? null,
      }),
    ),
    ...(old === null
      ? []
      : supersedeRecordStatements({
          oldRecordId: old.id,
          newRecordId: id,
          // The old termination's block may cover an address the member
          // has since removed; the new one keeps it.
          carryBlockedEmails:
            input.level === "termination" && replacesActiveTermination,
          // Already lifted: it stays as it was, with its own lift reason.
          lift:
            old.liftedAt !== null
              ? null
              : {
                  set: {
                    liftedAt: now,
                    liftedBy: principal.userId,
                    liftReason: `Superseded by ${publicId}`,
                    updatedAt: now,
                    retainUntil: retentionFor({ ...old, liftedAt: now }, now),
                  },
                  audit: auditEvent(
                    principal.userId,
                    "conduct.lifted",
                    old.publicId,
                    { supersededBy: publicId },
                  ),
                },
        })),
  ];
  try {
    await runBatch(statements);
  } catch (err: unknown) {
    if (old !== null && isForeignKeyViolation(err)) {
      throw new Error(CORRECTION_LOST_RACE, { cause: err });
    }
    throw err;
  }
  // A correction's old record sends no lift notice: this one says it
  // replaces the earlier notice.
  if (input.level !== "note") {
    await sendNotice({
      recordId: id,
      subjectUserId: input.subjectUserId,
      level: input.level,
      lifted: false,
      corrects: old !== null,
      statement: input.memberStatement,
      ...noticeDates(input),
    });
  }
  // Deactivation assumes an approved subject: a pending one cannot be
  // picked (`searchSubjects` and `findSubject` offer approved members
  // only) and approval refuses a terminated one. A deactivated subject,
  // as in a termination correcting a termination, transitions nothing.
  if (input.level === "termination") {
    await deactivateSubject(principal.userId, input.subjectUserId);
  }
  return { publicId };
}

/**
 * A termination deactivates the account, after the notice has gone (so
 * the email is not racing the sign-out) and in its own write, so the
 * record stands if this fails. A subject who is not approved (pending,
 * already deactivated) transitions nothing, which is fine. A failure is
 * logged and surfaced: the officer must know the account is still live.
 */
async function deactivateSubject(
  actorUserId: string,
  subjectUserId: string,
): Promise<void> {
  try {
    await deactivateUserStatements(actorUserId, [subjectUserId]);
  } catch (err: unknown) {
    log.error("conduct.deactivation_failed", { error: errorMessage(err) });
    throw new Error(DEACTIVATION_FAILED, { cause: err });
  }
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
  // A note's text is all it holds, as `createRecordSchema` insists.
  if (record.level === "note" && input.internalNotes === "") {
    throw new Error("A note needs its text");
  }
  const now = Temporal.Now.instant();
  // The statement is locked once the notice has gone out. That needs no
  // check here: `updateRecordSchema` carries `internalNotes` only, and
  // this write sets nothing else, so a sent record's statement, level and
  // dates cannot change. A test pins it; keep any new editable field out
  // of this write unless it is also refused once `notice_sent_at` is set.
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
  const lifted = await transition(record, "unlifted", ALREADY_LIFTED, {
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
  // The lift reason is not emailed (it is in the member's data export): the
  // member is told the level and that it was lifted.
  if (record.level !== "note") {
    await sendNotice({
      recordId: record.id,
      subjectUserId: record.subjectUserId,
      level: record.level,
      lifted: true,
    });
  }
  return lifted;
}
