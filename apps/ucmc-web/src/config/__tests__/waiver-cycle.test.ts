import { describe, expect, it } from "vitest";

import { currentWaiverCycle } from "#/config/waiver-cycle";

// The cycle rolls over at midnight Cincinnati-local (America/New_York,
// UTC-4 in August/EDT) on Aug 21 — NOT midnight UTC. The offset-suffixed
// and Z-suffixed instants below pin both sides of that local boundary.
describe("currentWaiverCycle", () => {
  it("returns YYYY-YY for a midwinter date inside the cycle", () => {
    expect(
      currentWaiverCycle(Temporal.Instant.from("2026-01-15T12:00:00Z")),
    ).toBe("2025-26");
  });

  it("treats Aug 20 (local) as the tail end of the previous cycle", () => {
    expect(
      currentWaiverCycle(Temporal.Instant.from("2025-08-20T23:59:59-04:00")),
    ).toBe("2024-25");
  });

  it("rolls over to the new cycle at local midnight on Aug 21", () => {
    expect(
      currentWaiverCycle(Temporal.Instant.from("2025-08-21T00:00:00-04:00")),
    ).toBe("2025-26");
  });

  it("rolls over on the LOCAL boundary, not UTC midnight", () => {
    // 2025-08-21T00:00Z is 2025-08-20 20:00 EDT — still the prior cycle.
    expect(
      currentWaiverCycle(Temporal.Instant.from("2025-08-21T00:00:00Z")),
    ).toBe("2024-25");
    // 2025-08-21T05:00Z is 2025-08-21 01:00 EDT — into the new cycle.
    expect(
      currentWaiverCycle(Temporal.Instant.from("2025-08-21T05:00:00Z")),
    ).toBe("2025-26");
  });

  it("stays in the new cycle through the rest of the calendar year", () => {
    expect(
      currentWaiverCycle(Temporal.Instant.from("2025-12-31T23:59:59Z")),
    ).toBe("2025-26");
  });

  it("crosses year boundaries cleanly", () => {
    expect(
      currentWaiverCycle(Temporal.Instant.from("2026-08-20T12:00:00-04:00")),
    ).toBe("2025-26");
    expect(
      currentWaiverCycle(Temporal.Instant.from("2026-08-21T00:00:00-04:00")),
    ).toBe("2026-27");
  });

  it("does not treat an early day in a later month as before the cutoff", () => {
    // Sept 10 is day 10, which is less than the cutoff day of 21 — but
    // September is past August, so it belongs to the NEW cycle. The two
    // halves of the cutoff test have to be read together: a mutation
    // replacing `month === CUTOFF.month` with `true` leaves every other
    // test in this file passing and gets this one wrong by a whole year.
    // (Found by Stryker; this test is why that mutant now dies.)
    expect(
      currentWaiverCycle(Temporal.Instant.from("2025-09-10T12:00:00-04:00")),
    ).toBe("2025-26");

    // The mirror case on the other side: June 10 is also day 10, in a
    // month before the cutoff, and belongs to the OLD cycle.
    expect(
      currentWaiverCycle(Temporal.Instant.from("2025-06-10T12:00:00-04:00")),
    ).toBe("2024-25");
  });

  it("accepts an Instant built from an epoch", () => {
    const ts = Date.UTC(2026, 0, 15, 12);
    expect(currentWaiverCycle(Temporal.Instant.fromEpochMilliseconds(ts))).toBe(
      "2025-26",
    );
  });
});
