/**
 * The reminder ladder's policy, tested without a database, a clock or an
 * email provider — which is the entire reason `loan-reminders.ts` is
 * pure.
 *
 * Every instant here is written in Cincinnati local time, because that
 * is the zone the rungs are computed in and a UTC literal would make
 * every expectation an exercise in offset arithmetic.
 */
import { describe, expect, it } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import {
  categoryForStage,
  nextReminderStage,
  stageForLoan,
  stageRank,
} from "#/features/gear/lib/loan-reminders";
import type { LoanReminderStage } from "#/features/gear/lib/loan-reminders";
import { computeDueAt } from "#/features/gear/lib/loan-duration";

const thresholds = {
  dueSoonLeadDays: 2,
  flagAfterDays: 7,
  blockAfterDays: 21,
};

/** 9am Cincinnati on the given date — a plausible checkout moment. */
const at = (isoDate: string): Temporal.Instant =>
  Temporal.ZonedDateTime.from(
    `${isoDate}T09:00:00[${CLUB_TIME_ZONE}]`,
  ).toInstant();

/** Due end-of-day on `isoDate`, the way `computeDueAt` stamps it. */
const dueOn = (isoDate: string): Temporal.Instant =>
  computeDueAt(at(isoDate), 0);

const stageOn = (dueDate: string, today: string): LoanReminderStage =>
  stageForLoan({
    dueAt: dueOn(dueDate),
    now: at(today),
    timeZone: CLUB_TIME_ZONE,
    thresholds,
  });

describe("stageForLoan", () => {
  it.each([
    [
      "six days out, well clear of the lead window",
      "2026-03-20",
      "2026-03-14",
      "none",
    ],
    [
      "three days out, one day short of the window",
      "2026-03-20",
      "2026-03-17",
      "none",
    ],
    ["exactly the lead time away", "2026-03-20", "2026-03-18", "due_soon"],
    ["the day before", "2026-03-20", "2026-03-19", "due_soon"],
    ["the due day itself", "2026-03-20", "2026-03-20", "due_soon"],
    ["one day past", "2026-03-20", "2026-03-21", "overdue"],
    [
      "six days past, still short of the flag",
      "2026-03-20",
      "2026-03-26",
      "overdue",
    ],
    ["exactly the flag threshold", "2026-03-20", "2026-03-27", "flagged"],
    [
      "twenty days past, still short of the block",
      "2026-03-20",
      "2026-04-09",
      "flagged",
    ],
    ["exactly the block threshold", "2026-03-20", "2026-04-10", "blocked"],
    ["long past the block threshold", "2026-03-20", "2026-06-01", "blocked"],
  ])("%s", (_label, due, today, expected) => {
    expect(stageOn(due, today)).toBe(expected);
  });

  it("does not call a loan overdue on its own due evening", () => {
    // `computeDueAt` stamps 23:59:59.999 local, so there is a window
    // where the loan is past *no* instant yet and a naive ">= 0 days
    // overdue" check would mail somebody whose gear is due tonight.
    const dueAt = dueOn("2026-03-20");
    const justBefore = Temporal.ZonedDateTime.from(
      `2026-03-20T23:59:00[${CLUB_TIME_ZONE}]`,
    ).toInstant();

    expect(
      stageForLoan({
        dueAt,
        now: justBefore,
        timeZone: CLUB_TIME_ZONE,
        thresholds,
      }),
    ).toBe("due_soon");
  });

  it("counts club days, not elapsed hours, across a DST transition", () => {
    // US spring-forward is 2026-03-08. A loan due the day before and
    // checked the day after has had 23 hours elapse, not 24 — an
    // elapsed-time calculation would report 0 days overdue and stay
    // silent. The borrower's calendar says a day turned.
    expect(stageOn("2026-03-07", "2026-03-08")).toBe("overdue");
  });

  it("honours the stricter threshold when block is set below flag", () => {
    // `gearCaveStanding` treats this as a misconfiguration to honour
    // rather than reject — whichever fires, the stricter governs. The
    // ladder has to agree, or the email and the desk describe different
    // states for the same member.
    expect(
      stageForLoan({
        dueAt: dueOn("2026-03-20"),
        now: at("2026-03-26"),
        timeZone: CLUB_TIME_ZONE,
        thresholds: { ...thresholds, flagAfterDays: 7, blockAfterDays: 5 },
      }),
    ).toBe("blocked");
  });
});

describe("nextReminderStage", () => {
  const next = (recordedStage: LoanReminderStage, today: string) =>
    nextReminderStage({
      dueAt: dueOn("2026-03-20"),
      now: at(today),
      timeZone: CLUB_TIME_ZONE,
      thresholds,
      recordedStage,
    });

  it("returns the rung when it outranks what was recorded", () => {
    expect(next("none", "2026-03-19")).toBe("due_soon");
    expect(next("due_soon", "2026-03-21")).toBe("overdue");
    expect(next("overdue", "2026-03-27")).toBe("flagged");
    expect(next("flagged", "2026-04-10")).toBe("blocked");
  });

  it("returns null when the rung has already been sent", () => {
    // This is the idempotence: a second run on the same day, or any run
    // on one of the many days between two rungs, sends nothing.
    expect(next("due_soon", "2026-03-19")).toBeNull();
    expect(next("overdue", "2026-03-22")).toBeNull();
    expect(next("flagged", "2026-04-01")).toBeNull();
  });

  it("never descends, even when the recorded stage is ahead", () => {
    // A loan whose due date was extended still carries its old stage
    // until `extendLoanAction` resets it. Until then the ladder must sit
    // still rather than mailing a "due soon" after a "blocked".
    expect(next("blocked", "2026-03-19")).toBeNull();
    expect(next("flagged", "2026-03-21")).toBeNull();
  });

  it("skips straight to the rung actually reached", () => {
    // A loan backfilled from CSV, or one the job missed for a week
    // during an outage, jumps to where it really is rather than walking
    // every intermediate rung on consecutive mornings.
    expect(next("none", "2026-04-10")).toBe("blocked");
    expect(next("none", "2026-03-27")).toBe("flagged");
  });

  it("stops at blocked", () => {
    // Terminal on purpose: past the block threshold it is officer
    // chasing, not more mail.
    expect(next("blocked", "2026-09-01")).toBeNull();
  });
});

describe("categoryForStage", () => {
  it("routes only the courtesy rung to the suppressible category", () => {
    expect(categoryForStage("due_soon")).toBe("gear.loan_due_soon");
    for (const stage of ["overdue", "flagged", "blocked"] as const) {
      // All three overdue rungs share one category: they are an
      // escalation of one thing, and splitting them would offer an
      // opt-out from part of a notice that has none.
      expect(categoryForStage(stage)).toBe("gear.loan_overdue");
    }
  });
});

describe("stageRank", () => {
  it("orders the ladder strictly", () => {
    const ranks = (
      ["none", "due_soon", "overdue", "flagged", "blocked"] as const
    ).map(stageRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});
