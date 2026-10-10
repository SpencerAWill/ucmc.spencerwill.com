import { describe, expect, it } from "vitest";

import {
  cancellationRate,
  formatShare,
  shareOf,
} from "#/features/analytics/lib/rates";

describe("cancellationRate", () => {
  it("divides by everything scheduled, not by what was held", () => {
    // "We cancel a quarter of what we plan" is cancelled over
    // scheduled. Dividing by `held` would report 33% for the same club.
    expect(cancellationRate(3, 1)).toBeCloseTo(0.25);
  });

  it("refuses to answer when nothing was scheduled", () => {
    // 0% would claim a perfect record the club did not earn — it
    // simply never put anything on the calendar.
    expect(cancellationRate(0, 0)).toBeNull();
  });

  it("reports a fully-cancelled season as 100%, not as null", () => {
    expect(cancellationRate(0, 4)).toBe(1);
  });
});

describe("shareOf", () => {
  it("returns null for a zero denominator rather than 0 or NaN", () => {
    expect(shareOf(0, 0)).toBeNull();
    expect(shareOf(5, 0)).toBeNull();
  });

  it("does not clamp a share over 1", () => {
    // Clamping would hide a real data problem behind a plausible number.
    expect(shareOf(3, 2)).toBeCloseTo(1.5);
  });
});

describe("formatShare", () => {
  it("renders a null share as an em dash, never as 0%", () => {
    expect(formatShare(null)).toBe("—");
  });

  it("rounds to whole percent", () => {
    expect(formatShare(0.237)).toBe("24%");
    expect(formatShare(0)).toBe("0%");
  });
});
