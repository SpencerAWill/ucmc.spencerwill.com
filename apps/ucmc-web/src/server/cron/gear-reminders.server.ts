/**
 * The daily gear loan reminder job, run by the worker's `scheduled`
 * handler alongside the retention sweeps.
 *
 * Until this existed the entire overdue apparatus was silent: the only
 * thing that ever told a member they were late was the banner on
 * `/my/gear`, and nothing ever gave them a reason to open it. A member
 * could cross the flag threshold, cross the block threshold, and find
 * out at the desk with a trip leaving in an hour.
 *
 * ## Shape
 *
 * Two passes, one per notification category, because they have different
 * opt-out rules and the suppressed set is one query each:
 *
 *   1. `gear.loan_due_soon` — courtesy, opt-out-able.
 *   2. `gear.loan_overdue`  — relationship mail, not opt-out-able, and
 *      covers all three overdue rungs.
 *
 * Within a pass, loans are grouped **by member**, so somebody holding
 * four overdue items gets one email listing four items rather than four
 * emails. The message is written at the highest rung any of their loans
 * has reached.
 *
 * ## Ordering, and why it is this way round
 *
 * Send first, advance the stage second. A provider failure then leaves
 * the stage where it was and tomorrow's run retries; the reverse order
 * marks unsent mail as sent and the member never hears anything. The
 * cost of this choice is a possible duplicate if the worker dies between
 * the two, which is why the send also carries an idempotency key.
 *
 * ## Everything is a parameter
 *
 * `now` is injected rather than read from the clock, like
 * `gearCaveStanding` and `currentSeason`, so tests pin it and a run
 * that straddles midnight can't produce two different answers.
 */
import { CLUB_TIME_ZONE } from "#/config/time";
import {
  categoryForStage,
  nextReminderStage,
  stageRank,
} from "#/features/gear/lib/loan-reminders";
import type { LoanReminderStage } from "#/features/gear/lib/loan-reminders";
import { env } from "#/server/cloudflare-env";
import { gearReminderEmail } from "#/server/email/gear-reminder-email";
import type { ReminderLoanLine } from "#/server/email/gear-reminder-email";
import { sendEmail } from "#/server/email/resend";
import { errorMessage, log } from "#/server/log/log.server";
import { redactEmail } from "#/server/log/redact.server";
import { listSuppressedUserIds } from "#/server/notifications/notification-prefs-repo.server";
import { readSetting } from "#/server/settings/settings-repo.server";

/**
 * Most emails one run will send.
 *
 * The job sends sequentially inside a Worker, which has a subrequest
 * ceiling. A cave with more than this many members crossing a rung on
 * one morning is either in its first week or in trouble; either way,
 * truncating visibly and finishing the tail tomorrow beats hitting the
 * platform limit and failing the run halfway with no record of where it
 * got to.
 */
const MAX_SENDS_PER_RUN = 100;

export interface GearReminderRunResult {
  /** True when `gear.remindersEnabled` is off — nothing was read or sent. */
  skipped: boolean;
  candidates: number;
  sent: number;
  /** Members suppressed by their own preference. */
  suppressed: number;
  /** Members with no verified primary address. */
  noEmail: number;
  failed: number;
  /** True when `MAX_SENDS_PER_RUN` cut the run short. */
  truncated: boolean;
}

interface MemberBatch {
  memberUserId: string;
  email: string;
  preferredName: string | null;
  stage: Exclude<LoanReminderStage, "none">;
  loanIds: string[];
  lines: ReminderLoanLine[];
}

export async function runGearLoanReminders(input: {
  now: Temporal.Instant;
}): Promise<GearReminderRunResult> {
  const empty: GearReminderRunResult = {
    skipped: false,
    candidates: 0,
    sent: 0,
    suppressed: 0,
    noEmail: 0,
    failed: 0,
    truncated: false,
  };

  // The kill switch is read first and nothing else happens when it is
  // off — no scan, no sends. This is the control an operator reaches for
  // during a bad send or a provider incident, so it has to be the first
  // thing in the path, not a filter near the end.
  const enabled = await readSetting("gear.remindersEnabled");
  if (!enabled) {
    log.info("gear_reminders.disabled", {});
    return { ...empty, skipped: true };
  }

  const [dueSoonLeadDays, flagAfterDays, blockAfterDays, caveHours] =
    await Promise.all([
      readSetting("gear.dueSoonLeadDays"),
      readSetting("gear.overdueFlagDays"),
      readSetting("gear.overdueBlockDays"),
      readSetting("gear.caveHoursNote"),
    ]);
  const thresholds = { dueSoonLeadDays, flagAfterDays, blockAfterDays };

  const { listOpenLoansForReminders, advanceLoanReminderStage } =
    await import("#/features/gear/server/loans-repo.server");
  const candidates = await listOpenLoansForReminders();

  // Group by member AND category. Two members' worth of overdue gear
  // must not share an email, and a member's due-soon nudge must not be
  // merged into their overdue notice — the two obey different opt-out
  // rules, and merging them would smuggle courtesy content into mail
  // that carries no unsubscribe.
  const batches = new Map<string, MemberBatch>();
  const noEmailLoans = new Set<string>();
  for (const loan of candidates) {
    const stage = nextReminderStage({
      dueAt: loan.dueAt,
      now: input.now,
      timeZone: CLUB_TIME_ZONE,
      thresholds,
      recordedStage: loan.reminderStage,
    });
    if (stage === null) continue;
    if (loan.memberEmail === null) {
      // Not advanced: if they verify an address later, the ladder picks
      // them up where they actually are.
      noEmailLoans.add(loan.memberUserId);
      log.warn("gear_reminders.no_verified_email", {
        loanPublicId: loan.publicId,
      });
      continue;
    }
    const category = categoryForStage(stage);
    const key = `${loan.memberUserId}:${category}`;
    const existing = batches.get(key);
    if (existing) {
      existing.loanIds.push(loan.id);
      existing.lines.push({ gearLabel: loan.gearLabel, dueAt: loan.dueAt });
      // The message is written at the worst rung in the batch, so a
      // member who is blocked on one rope and merely overdue on another
      // is told about the block.
      if (stageRank(stage) > stageRank(existing.stage)) {
        existing.stage = stage;
      }
      continue;
    }
    batches.set(key, {
      memberUserId: loan.memberUserId,
      email: loan.memberEmail,
      preferredName: loan.memberPreferredName,
      stage,
      loanIds: [loan.id],
      lines: [{ gearLabel: loan.gearLabel, dueAt: loan.dueAt }],
    });
  }

  const result: GearReminderRunResult = {
    ...empty,
    candidates: batches.size,
    noEmail: noEmailLoans.size,
  };
  if (batches.size === 0) {
    log.info("gear_reminders.complete", { ...result });
    return result;
  }

  // One suppressed-set read per category for the whole run, which is
  // what the `(category, channel, enabled)` index exists for. A throw
  // here abandons the run rather than proceeding with an empty set —
  // "nobody opted out" is exactly the wrong guess to make.
  const suppressedDueSoon = await listSuppressedUserIds({
    category: "gear.loan_due_soon",
    channel: "email",
  });

  const baseUrl = env.APP_BASE_URL;
  const myGearUrl = `${baseUrl}/my/gear`;
  const preferencesUrl = `${baseUrl}/my/preferences`;
  const clubDate = input.now
    .toZonedDateTimeISO(CLUB_TIME_ZONE)
    .toPlainDate()
    .toString();

  for (const batch of batches.values()) {
    if (result.sent >= MAX_SENDS_PER_RUN) {
      result.truncated = true;
      break;
    }
    const category = categoryForStage(batch.stage);
    // Only the courtesy category can be suppressed. `gear.loan_overdue`
    // is non-suppressible, so it is never looked up — a stray row must
    // not be able to silence it.
    if (
      category === "gear.loan_due_soon" &&
      suppressedDueSoon.has(batch.memberUserId)
    ) {
      result.suppressed += 1;
      // Stage still advances: the member made a choice, and leaving the
      // rung unrecorded would re-evaluate them every morning forever and
      // hold the ladder at a rung they have already passed.
      await advanceLoanReminderStage({
        loanIds: batch.loanIds,
        stage: batch.stage,
        now: input.now,
      });
      continue;
    }

    // Sorted so the message reads oldest-due first, which is the order
    // somebody would chase their own pile in.
    const lines = [...batch.lines].sort((a, b) =>
      Temporal.Instant.compare(a.dueAt, b.dueAt),
    );

    try {
      await sendEmail({
        ...gearReminderEmail({
          to: batch.email,
          preferredName: batch.preferredName,
          stage: batch.stage,
          loans: lines,
          myGearUrl,
          preferencesUrl,
          caveHours,
        }),
        // Scoped to the club day so a same-day re-run is deduped by the
        // provider even if the stage advance below never landed.
        idempotencyKey: `gear-reminder:${batch.memberUserId}:${batch.stage}:${clubDate}`,
      });
    } catch (err: unknown) {
      result.failed += 1;
      // One member's bounce must not abandon everyone else's mail, and
      // the stage is deliberately NOT advanced — tomorrow retries.
      log.error("gear_reminders.send_failed", {
        to: redactEmail(batch.email),
        stage: batch.stage,
        error: errorMessage(err),
      });
      continue;
    }

    await advanceLoanReminderStage({
      loanIds: batch.loanIds,
      stage: batch.stage,
      now: input.now,
    });
    result.sent += 1;
  }

  log.info("gear_reminders.complete", { ...result });
  return result;
}
