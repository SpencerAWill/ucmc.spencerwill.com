import { describe, expect, it } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import {
  DEFAULT_LOAN_DURATION_DAYS,
  MAX_LOAN_DURATION_DAYS,
  computeDueAt,
} from "#/features/gear/lib/loan-duration";
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
