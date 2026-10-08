/**
 * The loan reminder ladder: which rung a loan has reached, and whether
 * that is further than the rung it was last emailed about.
 *
 * Pure on purpose — every input is a parameter, including `now` — so the
 * whole policy can be tested exhaustively without a database, a clock or
 * an email provider. The cron module is then only plumbing.
 *
 * **The rungs are the thresholds the system already computes.** Rather
 * than inventing a reminder cadence, each rung is a state transition a
 * member can actually observe, so the email says something true and
 * actionable instead of nagging:
 *
 *   due_soon  — `gear.dueSoonLeadDays` before the due date
 *   overdue   — one club day past due
 *   flagged   — `gear.overdueFlagDays`, the day the desk starts flagging
 *   blocked   — `gear.overdueBlockDays`, the day checkout stops working
 *
 * Only `dueSoonLeadDays` is new; the other two are the site settings
 * `gearCaveStanding` reads, which is what keeps the email and the desk
 * from disagreeing about what day somebody got flagged.
 *
 * **Terminal at `blocked`.** Past that it is officer chasing, not more
 * mail — a daily email to somebody already blocked is how a reminder
 * system teaches people to filter it.
 */
import { clubDayDifference } from "#/lib/club-days";

export const LOAN_REMINDER_STAGES = [
  "none",
  "due_soon",
  "overdue",
  "flagged",
  "blocked",
] as const;

export type LoanReminderStage = (typeof LOAN_REMINDER_STAGES)[number];

/**
 * Rung order. The ladder only ever climbs, which is what makes the job
 * idempotent: a stage is advanced only when the computed rung outranks
 * the recorded one, so re-running on the same day sends nothing and a
 * missed day is caught at the right rung rather than skipped.
 */
const STAGE_RANK: Record<LoanReminderStage, number> = {
  none: 0,
  due_soon: 1,
  overdue: 2,
  flagged: 3,
  blocked: 4,
};

export function stageRank(stage: LoanReminderStage): number {
  return STAGE_RANK[stage];
}

/**
 * Which notification category a rung belongs to.
 *
 * Two categories, not four: the three overdue rungs are an escalation of
 * one thing, and a member who doesn't want to hear about overdue gear
 * can't have that wish granted anyway — `gear.loan_overdue` is
 * non-suppressible. Only `due_soon` is a courtesy.
 */
export function categoryForStage(
  stage: Exclude<LoanReminderStage, "none">,
): "gear.loan_due_soon" | "gear.loan_overdue" {
  return stage === "due_soon" ? "gear.loan_due_soon" : "gear.loan_overdue";
}

export interface LoanReminderThresholds {
  /** Days before the due date the courtesy nudge fires. */
  dueSoonLeadDays: number;
  /** `gear.overdueFlagDays` — the desk starts flagging. */
  flagAfterDays: number;
  /** `gear.overdueBlockDays` — checkout stops working. */
  blockAfterDays: number;
}

/**
 * The rung an open loan has reached as of `now`.
 *
 * Thresholds are checked strictest-first, which matters when an operator
 * sets `blockAfterDays` below `flagAfterDays`. `gearCaveStanding` treats
 * that as a misconfiguration to honour rather than an error — whichever
 * fires, the stricter governs — and this has to agree with it, or the
 * email and the desk would describe different states.
 */
export function stageForLoan(input: {
  dueAt: Temporal.Instant;
  now: Temporal.Instant;
  timeZone: string;
  thresholds: LoanReminderThresholds;
}): LoanReminderStage {
  const { dueAt, now, timeZone, thresholds } = input;
  const overdue = Temporal.Instant.compare(now, dueAt) > 0;

  if (overdue) {
    const daysOverdue = clubDayDifference(dueAt, now, timeZone);
    if (daysOverdue >= thresholds.blockAfterDays) return "blocked";
    if (daysOverdue >= thresholds.flagAfterDays) return "flagged";
    // Strictly past the due *day*, not merely past the due instant. A
    // loan due end-of-today is not overdue mail at 11:59pm.
    if (daysOverdue >= 1) return "overdue";
    return "due_soon";
  }

  const daysUntilDue = clubDayDifference(now, dueAt, timeZone);
  return daysUntilDue <= thresholds.dueSoonLeadDays ? "due_soon" : "none";
}

/**
 * The rung to email about, or `null` when the loan is already at or past
 * the rung it was last emailed about.
 */
export function nextReminderStage(input: {
  dueAt: Temporal.Instant;
  now: Temporal.Instant;
  timeZone: string;
  thresholds: LoanReminderThresholds;
  recordedStage: LoanReminderStage;
}): Exclude<LoanReminderStage, "none"> | null {
  const target = stageForLoan(input);
  if (target === "none") return null;
  return stageRank(target) > stageRank(input.recordedStage) ? target : null;
}
