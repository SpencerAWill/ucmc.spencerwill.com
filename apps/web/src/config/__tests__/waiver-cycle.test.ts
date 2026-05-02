import { describe, expect, it } from "vitest";

import { currentWaiverCycle } from "#/config/waiver-cycle";

describe("currentWaiverCycle", () => {
  it("returns YYYY-YY for a midwinter date inside the cycle", () => {
    expect(currentWaiverCycle(new Date("2026-01-15T12:00:00Z"))).toBe(
      "2025-26",
    );
  });

  it("treats Aug 20 as the tail end of the previous cycle", () => {
    expect(currentWaiverCycle(new Date("2025-08-20T23:59:59Z"))).toBe(
      "2024-25",
    );
  });

  it("rolls over to the new cycle at Aug 21", () => {
    expect(currentWaiverCycle(new Date("2025-08-21T00:00:00Z"))).toBe(
      "2025-26",
    );
  });

  it("stays in the new cycle through the rest of the calendar year", () => {
    expect(currentWaiverCycle(new Date("2025-12-31T23:59:59Z"))).toBe(
      "2025-26",
    );
  });

  it("crosses year boundaries cleanly", () => {
    expect(currentWaiverCycle(new Date("2026-08-20T12:00:00Z"))).toBe(
      "2025-26",
    );
    expect(currentWaiverCycle(new Date("2026-08-21T00:00:00Z"))).toBe(
      "2026-27",
    );
  });

  it("accepts a numeric epoch and a Date interchangeably", () => {
    const ts = Date.UTC(2026, 0, 15, 12);
    expect(currentWaiverCycle(ts)).toBe(currentWaiverCycle(new Date(ts)));
  });
});
