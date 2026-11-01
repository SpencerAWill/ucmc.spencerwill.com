/**
 * Conduct report actions. The shells in `./report-fns.ts` dynamic-import
 * this module; tests call it directly.
 *
 * Rules every action here keeps:
 *
 *   - **A reporter never reads a report back.** Submitting answers
 *     `{ ok: true }` and nothing else, and there is no "my reports" read:
 *     only `conduct:view` lists them.
 *   - **A viewer never reads a report about themselves.** The repo filters
 *     those out, so `list` leaves them out and triaging one is "Report not
 *     found".
 *   - **One batch per write**, holding the write and its audit row. Audit
 *     rows target `('conduct_report', publicId)`, leave `targetUserId`
 *     null as the record rows do, and carry ids, `possibleScoc` and the
 *     state transition only, never the body, the location or a name.
 *   - **A flagged report joins an existing record only while it is
 *     referred to SCCS**, and a report a record cites cannot be
 *     dismissed. Citing a `new` report in a record's creation accepts it.
 *   - **Triage happens once.** The UPDATE is guarded on `status = 'new'`
 *     and so is every other statement in its batch, so the loser of two
 *     racing triages writes nothing and throws "Report already triaged".
 *   - **`retain_until`** is five years from filing, then five years from
 *     acceptance or one year from dismissal (`retention.ts`).
 */
import { uuidv7 } from "uuidv7";

import type { ConductReportStatus } from "#/../drizzle/schema";
import {
  requireConductManager,
  requireConductReporter,
  requireConductViewer,
} from "#/features/conduct/server/conduct-guards.server";
import type {
  AcceptReportArgs,
  DismissReportArgs,
  SubmitReportArgs,
} from "#/features/conduct/server/limits";
import {
  findRecordForMutation,
  searchSubjects,
} from "#/features/conduct/server/record-repo.server";
import {
  applyReportTriage,
  findApprovedMemberId,
  findReportForTriage,
  insertReportStatement,
  listConductManagerRecipients,
  listReports,
} from "#/features/conduct/server/report-repo.server";
import type {
  ConductReportSummary,
  ReportForTriage,
} from "#/features/conduct/server/report-repo.server";
import { buildAuditEventStatement } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { retainUntil } from "#/server/conduct/retention";
import { runBatch } from "#/server/db";
import { conductReportReceivedEmail } from "#/server/email/conduct-email";
import { sendEmail } from "#/server/email/resend";
import { serverEnv } from "#/server/env.server";
import { errorMessage, log } from "#/server/log/log.server";
import { listSuppressedUserIds } from "#/server/notifications/notification-prefs-repo.server";
import { checkConductReportRateLimit } from "#/server/rate-limit.server";
import { readSetting } from "#/server/settings/settings-repo.server";

export type { ConductReportSummary };

const TARGET_TYPE = "conduct_report";
const ALREADY_TRIAGED = "Report already triaged";
const REPORT_ATTACHED = "Report is attached to a record";

function retention(
  status: ConductReportStatus,
  lastActivity: Temporal.Instant,
): Temporal.Instant | null {
  return retainUntil({ kind: "report", status, lastActivity });
}

// ── submit ──────────────────────────────────────────────────────────────

/** A member option in the report dialog's picker: public id and name only. */
export interface ReportSubjectOption {
  publicId: string;
  fullName: string;
}

const SUBJECT_SEARCH_LIMIT = 10;

/**
 * Name search behind the report dialog's picker. Gated by
 * `conduct:report`, not `conduct:manage`, and returns public ids only:
 * internal ids never reach a member.
 */
export async function searchReportSubjectsAction(input: {
  q: string;
}): Promise<ReportSubjectOption[]> {
  const principal = await requireConductReporter();
  const q = input.q.trim();
  if (q.length === 0) {
    return [];
  }
  const found = await searchSubjects(q, principal.userId, SUBJECT_SEARCH_LIMIT);
  return found.map(({ publicId, fullName }) => ({ publicId, fullName }));
}

/**
 * Tell each opted-in `conduct:manage` holder that a report is waiting. The
 * report's subject and its reporter are left out: a manager is not told of
 * a report about themselves. The email says nothing about the report.
 *
 * Never throws: the report is already committed, and a failed notice must
 * not fail the submission. `sendEmail` records each attempt itself.
 */
async function notifyManagers(excludeUserIds: readonly string[]) {
  try {
    const [recipients, suppressed] = await Promise.all([
      listConductManagerRecipients(excludeUserIds),
      listSuppressedUserIds({
        category: "conduct.report_received",
        channel: "email",
      }),
    ]);
    const origin = serverEnv().APP_BASE_URL;
    for (const recipient of recipients) {
      if (suppressed.has(recipient.userId)) {
        continue;
      }
      try {
        await sendEmail(
          conductReportReceivedEmail({ to: recipient.email, origin }),
        );
      } catch (err: unknown) {
        log.error("conduct.report_notice_failed", {
          error: errorMessage(err),
        });
      }
    }
  } catch (err: unknown) {
    log.error("conduct.report_notice_failed", { error: errorMessage(err) });
  }
}

export async function submitConductReportAction(
  input: SubmitReportArgs,
): Promise<{ ok: true }> {
  const principal = await requireConductReporter();
  const enabled = await readSetting("conduct_reports.submissions_enabled");
  if (!enabled) {
    throw new Error("Conduct reports are currently disabled.");
  }
  const subjectUserId =
    input.subjectPublicId === undefined
      ? null
      : await findApprovedMemberId(input.subjectPublicId);
  if (input.subjectPublicId !== undefined && subjectUserId === null) {
    throw new Error("Member not found");
  }
  if (subjectUserId === principal.userId) {
    throw new Error("You cannot report yourself");
  }
  const allowed = await checkConductReportRateLimit(principal.userId);
  if (!allowed) {
    throw new Error("Rate limit exceeded — please try again tomorrow.");
  }

  const now = Temporal.Now.instant();
  const publicId = generatePublicId();
  const description = input.subjectDescription ?? "";
  await runBatch([
    insertReportStatement({
      id: `crep_${uuidv7()}`,
      publicId,
      reporterUserId: principal.userId,
      subjectUserId,
      subjectDescription: description === "" ? null : description,
      occurredOn: input.occurredOn,
      location: input.location === "" ? null : input.location,
      body: input.body,
      possibleScoc: input.possibleScoc,
      status: "new",
      createdAt: now,
      retainUntil: retention("new", now),
    }),
    buildAuditEventStatement({
      actorUserId: principal.userId,
      action: "conduct.report_filed",
      targetType: TARGET_TYPE,
      targetId: publicId,
      metadata: { reportId: publicId, possibleScoc: input.possibleScoc },
    }),
  ]);
  await notifyManagers(
    subjectUserId === null
      ? [principal.userId]
      : [principal.userId, subjectUserId],
  );
  return { ok: true };
}

// ── list ────────────────────────────────────────────────────────────────

export async function listConductReportsAction(
  status?: ConductReportStatus,
): Promise<ConductReportSummary[]> {
  const principal = await requireConductViewer();
  return listReports(status, principal.userId);
}

// ── triage ──────────────────────────────────────────────────────────────

async function loadForTriage(
  publicId: string,
  viewerUserId: string,
): Promise<ReportForTriage> {
  const report = await findReportForTriage(publicId, viewerUserId);
  if (!report) {
    throw new Error("Report not found");
  }
  if (report.status !== "new") {
    throw new Error(ALREADY_TRIAGED);
  }
  return report;
}

/**
 * Accept a report. With `recordPublicId` it is attached to that record,
 * which must be about the member the report names (any record will do
 * for a report that names nobody). Without one it is only marked
 * accepted: the UI then creates a record citing it in `reportIds`.
 */
export async function acceptConductReportAction(
  input: AcceptReportArgs,
): Promise<{ ok: true }> {
  const principal = await requireConductManager();
  const report = await loadForTriage(input.reportId, principal.userId);

  const record =
    input.recordPublicId === undefined
      ? null
      : await findRecordForMutation(input.recordPublicId, principal.userId);
  if (input.recordPublicId !== undefined && record === null) {
    throw new Error("Record not found");
  }
  if (record !== null && report.subjectUserId !== null) {
    if (record.subjectUserId === null) {
      throw new Error("Record's member no longer exists");
    }
    if (record.subjectUserId !== report.subjectUserId) {
      throw new Error("Report is about a different member");
    }
  }
  // The SCOC lock: a flagged report joins a record only while SCCS has
  // it. Otherwise exec starts a record citing the report (forced to a
  // referred Note) or refers the existing record first.
  if (
    record !== null &&
    report.possibleScoc &&
    record.scocState !== "referred"
  ) {
    throw new Error("Referred to SCCS");
  }

  const now = Temporal.Now.instant();
  const applied = await applyReportTriage({
    reportId: report.id,
    set: {
      status: "accepted",
      triagedBy: principal.userId,
      triagedAt: now,
      retainUntil: retention("accepted", now),
    },
    linkRecordId: record?.id,
    audit: {
      actorUserId: principal.userId,
      action: "conduct.report_triaged",
      targetType: TARGET_TYPE,
      targetId: report.publicId,
      metadata: {
        from: "new",
        to: "accepted",
        recordId: record?.publicId ?? null,
      },
    },
  });
  if (!applied) {
    throw new Error(ALREADY_TRIAGED);
  }
  return { ok: true };
}

export async function dismissConductReportAction(
  input: DismissReportArgs,
): Promise<{ ok: true }> {
  const principal = await requireConductManager();
  const report = await findReportForTriage(input.reportId, principal.userId);
  if (!report) {
    throw new Error("Report not found");
  }
  if (report.linked) {
    throw new Error(REPORT_ATTACHED);
  }
  if (report.status !== "new") {
    throw new Error(ALREADY_TRIAGED);
  }
  const now = Temporal.Now.instant();
  const applied = await applyReportTriage({
    reportId: report.id,
    requireUnlinked: true,
    set: {
      status: "dismissed",
      triagedBy: principal.userId,
      triagedAt: now,
      dismissReason: input.reason,
      retainUntil: retention("dismissed", now),
    },
    audit: {
      actorUserId: principal.userId,
      action: "conduct.report_triaged",
      targetType: TARGET_TYPE,
      targetId: report.publicId,
      metadata: { from: "new", to: "dismissed", recordId: null },
    },
  });
  if (!applied) {
    throw new Error(ALREADY_TRIAGED);
  }
  return { ok: true };
}
