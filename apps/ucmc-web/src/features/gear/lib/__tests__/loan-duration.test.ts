import { describe, expect, it } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import {
  DEFAULT_LOAN_DURATION_DAYS,
  MAX_LOAN_DURATION_DAYS,
  computeDueAt,
  defaultLoanDurationDays,
} from "#/features/gear/lib/loan-duration";
import { parseWeekdayList } from "#/lib/weekdays";
import { SETTINGS } from "#/server/settings/settings-registry";

describe("DEFAULT_LOAN_DURATION_DAYS", () => {
  it("matches the gear.defaultLoanDays registry default", () => {
    // Two numbers, one policy. The setting is authoritative; the
    // constant is only what the checkout sheet shows for the instant
    // before the query resolves. If they drift, the officer watches the
    // prefill jump from one value to another on load — which looks like
    // a bug in the sheet rather than a mismatch between two files.
    expect(SETTINGS["gear.defaultLoanDays"].parse(undefined)).toBe(
      DEFAULT_LOAN_DURATION_DAYS,
    );
  });

  it("sits within the range the setting will accept", () => {
    // A fallback the setting itself would reject is a fallback nobody
    // can ever configure their way back to.
    expect(() =>
      SETTINGS["gear.defaultLoanDays"].parse(DEFAULT_LOAN_DURATION_DAYS),
    ).not.toThrow();
  });

  it("stays at or under the checkout ceiling", () => {
    // `MAX_LOAN_DURATION_DAYS` is clamped onto every checkout row, so a
    // default above it would be silently reduced and the sheet would
    // show a number the server never honours.
    expect(DEFAULT_LOAN_DURATION_DAYS).toBeLessThanOrEqual(
      MAX_LOAN_DURATION_DAYS,
    );
  });
});

describe("computeDueAt", () => {
  const at = (iso: string) =>
    Temporal.ZonedDateTime.from(`${iso}[${CLUB_TIME_ZONE}]`).toInstant();

  it("lands on the end of the club day, not the clock time of checkout", () => {
    const due = computeDueAt(at("2026-03-16T09:00:00"), 7);
    const local = due.toZonedDateTimeISO(CLUB_TIME_ZONE);

    // A 7-day loan taken at 9am Monday is due end-of-Monday a week
    // later, which is what the borrower means by "a week".
    expect(local.toPlainDate().toString()).toBe("2026-03-23");
    expect(local.hour).toBe(23);
    expect(local.minute).toBe(59);
  });

  it("gives a same-day loan the rest of today, not midnight this morning", () => {
    const due = computeDueAt(at("2026-03-16T09:00:00"), 0);

    // `durationDays = 0` is the exec-meeting loan-and-return case.
    // Midnight-today would be already overdue at the moment of checkout.
    expect(Temporal.Instant.compare(due, at("2026-03-16T09:00:00"))).toBe(1);
    expect(
      due.toZonedDateTimeISO(CLUB_TIME_ZONE).toPlainDate().toString(),
    ).toBe("2026-03-16");
  });

  it("counts calendar days across a DST transition", () => {
    // Spring-forward is 2026-03-08: elapsed-time arithmetic would land
    // an hour off and could tip the due date onto the previous day.
    const due = computeDueAt(at("2026-03-06T09:00:00"), 7);

    expect(
      due.toZonedDateTimeISO(CLUB_TIME_ZONE).toPlainDate().toString(),
    ).toBe("2026-03-13");
    expect(due.toZonedDateTimeISO(CLUB_TIME_ZONE).hour).toBe(23);
  });
});

describe("defaultLoanDurationDays", () => {
  // 2026-10-05 is a Monday, so `.add({ days: n })` lands on a predictable
  // weekday for every n in these cases.
  const monday = Temporal.PlainDate.from("2026-10-05");
  const WED = [3];

  it("leaves a Wednesday checkout's weekly rhythm alone", () => {
    // The case that already worked: Wednesday + 7 is a Wednesday. The
    // club's rhythm falls out of the plain arithmetic and nothing here
    // should perturb it.
    const wednesday = Temporal.PlainDate.from("2026-10-07");
    expect(defaultLoanDurationDays(wednesday, 7, WED)).toBe(7);
  });

  it("rolls a non-Wednesday checkout forward to the next open day", () => {
    // Monday + 7 is a Monday, a day the cave is shut. Rolling forward by
    // two lands on Wednesday the 14th — the member keeps the week they
    // were promised plus the wait for a door to be open.
    expect(defaultLoanDurationDays(monday, 7, WED)).toBe(9);
    expect(monday.add({ days: 9 }).dayOfWeek).toBe(3);
  });

  it("only ever rolls forward, never shortening the loan", () => {
    // A shorter loan than the one configured would be the system taking
    // back time it already offered.
    for (let duration = 1; duration <= 30; duration += 1) {
      expect(
        defaultLoanDurationDays(monday, duration, WED),
      ).toBeGreaterThanOrEqual(duration);
    }
  });

  it("always lands on an open day for any start and any open set", () => {
    const openSets = [[3], [1, 3], [7], [1, 2, 3, 4, 5, 6, 7]];
    for (const open of openSets) {
      for (let offset = 0; offset < 7; offset += 1) {
        const from = monday.add({ days: offset });
        const days = defaultLoanDurationDays(from, 7, open);
        expect(open).toContain(from.add({ days }).dayOfWeek);
      }
    }
  });

  it("leaves a same-day loan same-day", () => {
    // The exec-meeting loan-and-return: gear goes out and comes back
    // that evening. Rolling it forward would push it a week.
    expect(defaultLoanDurationDays(monday, 0, WED)).toBe(0);
  });

  it("does nothing when no open days are configured", () => {
    // The summer, when `gear.caveHoursNote` goes blank beside it.
    expect(defaultLoanDurationDays(monday, 7, [])).toBe(7);
  });

  it("gives up rather than breach the checkout ceiling", () => {
    // Checkout clamps to `MAX_LOAN_DURATION_DAYS`, so returning the
    // rolled value would just be clamped back onto a shut day — the
    // un-rolled default is the honest answer.
    const atCeiling = defaultLoanDurationDays(
      monday,
      MAX_LOAN_DURATION_DAYS,
      WED,
    );
    expect(atCeiling).toBeLessThanOrEqual(MAX_LOAN_DURATION_DAYS);
  });

  it("agrees with the registry default, which must parse to a weekday", () => {
    // The setting is free text validated by a refinement; a default the
    // parser rejects would leave the desk with no open days at all and
    // the roll-forward silently inert.
    const parsed = parseWeekdayList(
      SETTINGS["gear.caveOpenDays"].parse(undefined),
    );
    expect(parsed).toEqual([3]);
  });
});
