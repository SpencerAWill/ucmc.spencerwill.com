import { describe, expect, it } from "vitest";

import { currentSeason } from "#/config/club-season";

// The season rolls over at midnight Cincinnati-local (America/New_York,
// UTC-4 in August/EDT) on Aug 1 — NOT midnight UTC. The offset-suffixed
// and Z-suffixed instants below pin both sides of that local boundary.
describe("currentSeason", () => {
  it("returns YYYY-YY for a midwinter date inside the season", () => {
    expect(currentSeason(Temporal.Instant.from("2026-01-15T12:00:00Z"))).toBe(
      "2025-26",
    );
  });

  it("treats Jul 31 (local) as the tail end of the previous season", () => {
    expect(
      currentSeason(Temporal.Instant.from("2025-07-31T23:59:59-04:00")),
    ).toBe("2024-25");
  });

  it("rolls over to the new season at local midnight on Aug 1", () => {
    expect(
      currentSeason(Temporal.Instant.from("2025-08-01T00:00:00-04:00")),
    ).toBe("2025-26");
  });

  it("rolls over on the LOCAL boundary, not UTC midnight", () => {
    // 2025-08-01T00:00Z is 2025-07-31 20:00 EDT — still the prior season.
    expect(currentSeason(Temporal.Instant.from("2025-08-01T00:00:00Z"))).toBe(
      "2024-25",
    );
    // 2025-08-01T05:00Z is 2025-08-01 01:00 EDT — into the new season.
    expect(currentSeason(Temporal.Instant.from("2025-08-01T05:00:00Z"))).toBe(
      "2025-26",
    );
  });

  it("puts the first three weeks of August in the NEW season", () => {
    // The whole behavioural consequence of moving the boundary off Aug 21.
    // These three weeks used to answer the previous season, which meant a
    // trip going out on Aug 10 — the club does run them — counted against
    // a season that had ended, and rode on last season's waiver.
    expect(
      currentSeason(Temporal.Instant.from("2025-08-10T12:00:00-04:00")),
    ).toBe("2025-26");
    expect(
      currentSeason(Temporal.Instant.from("2025-08-20T23:59:59-04:00")),
    ).toBe("2025-26");
  });

  it("stays in the new season through the rest of the calendar year", () => {
    expect(currentSeason(Temporal.Instant.from("2025-12-31T23:59:59Z"))).toBe(
      "2025-26",
    );
  });

  it("crosses year boundaries cleanly", () => {
    expect(
      currentSeason(Temporal.Instant.from("2026-07-31T12:00:00-04:00")),
    ).toBe("2025-26");
    expect(
      currentSeason(Temporal.Instant.from("2026-08-01T00:00:00-04:00")),
    ).toBe("2026-27");
  });

  it("separates the two halves of the year by month, not by day-of-month", () => {
    // Both of these are the 10th. September is past the opening month and
    // belongs to the NEW season; June is before it and belongs to the OLD
    // one. A comparison that lost the month half — Stryker killed exactly
    // that mutant under the old two-part cutoff — gets one of them wrong
    // by a whole club year.
    expect(
      currentSeason(Temporal.Instant.from("2025-09-10T12:00:00-04:00")),
    ).toBe("2025-26");
    expect(
      currentSeason(Temporal.Instant.from("2025-06-10T12:00:00-04:00")),
    ).toBe("2024-25");
  });

  it("accepts an Instant built from an epoch", () => {
    const ts = Date.UTC(2026, 0, 15, 12);
    expect(currentSeason(Temporal.Instant.fromEpochMilliseconds(ts))).toBe(
      "2025-26",
    );
  });
});
