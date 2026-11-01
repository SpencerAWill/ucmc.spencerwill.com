import { describe, expect, it } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import { retainUntil } from "#/server/conduct/retention";

const T = Temporal.Instant.from("2026-03-10T15:00:00Z");

function plusYears(instant: Temporal.Instant, years: number) {
  return instant.toZonedDateTimeISO(CLUB_TIME_ZONE).add({ years }).toInstant();
}

describe("retainUntil", () => {
  it("keeps a dismissed report for one year", () => {
    const result = retainUntil({
      kind: "report",
      status: "dismissed",
      lastActivity: T,
    });
    expect(result?.equals(plusYears(T, 1))).toBe(true);
  });

  it("keeps an accepted report for five years", () => {
    const result = retainUntil({
      kind: "report",
      status: "accepted",
      lastActivity: T,
    });
    expect(result?.equals(plusYears(T, 5))).toBe(true);
  });

  it("keeps a note for five years after its last activity", () => {
    const result = retainUntil({
      kind: "record",
      level: "note",
      endsOn: null,
      liftedAt: null,
      lastActivity: T,
    });
    expect(result?.equals(plusYears(T, 5))).toBe(true);
  });

  it("counts a suspension from the end of its last day in Cincinnati", () => {
    const endsOn = Temporal.PlainDate.from("2026-06-30");
    const result = retainUntil({
      kind: "record",
      level: "suspension",
      endsOn,
      liftedAt: null,
      lastActivity: T,
    });
    const endOfDay = endsOn
      .add({ days: 1 })
      .toZonedDateTime(CLUB_TIME_ZONE)
      .toInstant();
    expect(result?.equals(plusYears(endOfDay, 5))).toBe(true);
  });

  it("counts from last activity when it is later than the end date", () => {
    const result = retainUntil({
      kind: "record",
      level: "suspension",
      endsOn: Temporal.PlainDate.from("2026-03-11"),
      liftedAt: null,
      lastActivity: Temporal.Instant.from("2026-09-01T12:00:00Z"),
    });
    expect(
      result?.equals(
        plusYears(Temporal.Instant.from("2026-09-01T12:00:00Z"), 5),
      ),
    ).toBe(true);
  });

  it("never expires an active termination", () => {
    expect(
      retainUntil({
        kind: "record",
        level: "termination",
        endsOn: null,
        liftedAt: null,
        lastActivity: T,
      }),
    ).toBeNull();
  });

  it("keeps a lifted termination for five years after the lift", () => {
    const liftedAt = Temporal.Instant.from("2027-01-05T17:00:00Z");
    const result = retainUntil({
      kind: "record",
      level: "termination",
      endsOn: null,
      liftedAt,
      lastActivity: liftedAt,
    });
    expect(result?.equals(plusYears(liftedAt, 5))).toBe(true);
  });
});
