import { describe, expect, it } from "vitest";

import {
  HEADROOM_AT_RISK,
  HEADROOM_WATCH,
  formatCents,
  formatHeadroom,
  formatQuantity,
  headroomSeverity,
} from "#/features/analytics/lib/headroom";

describe("headroomSeverity", () => {
  it("escalates at the two thresholds, inclusive", () => {
    // Inclusive on purpose: a service sitting exactly on 80% of its cap
    // is at risk, not merely worth watching.
    expect(headroomSeverity(HEADROOM_WATCH - 0.001)).toBe("healthy");
    expect(headroomSeverity(HEADROOM_WATCH)).toBe("watch");
    expect(headroomSeverity(HEADROOM_AT_RISK - 0.001)).toBe("watch");
    expect(headroomSeverity(HEADROOM_AT_RISK)).toBe("at-risk");
  });

  it("keeps calling a blown cap at-risk rather than wrapping", () => {
    // `headroomFraction` is deliberately unclamped, so values over 1
    // reach here and must not fall off the end of the ladder.
    expect(headroomSeverity(1.4)).toBe("at-risk");
  });

  it("treats an unused service as healthy", () => {
    expect(headroomSeverity(0)).toBe("healthy");
  });
});

describe("formatHeadroom", () => {
  // The club sits in the hundredths of most of its caps, so collapsing
  // small readings to "0%" would make the whole column look unmeasured.
  it("keeps a digit for sub-1% readings", () => {
    expect(formatHeadroom(0.00412)).toBe("0.41%");
  });

  it("falls back to an inequality below a tenth of a percent", () => {
    expect(formatHeadroom(0.0002)).toBe("<0.1%");
  });

  it("reports an exact zero as 0%, not as an inequality", () => {
    // A catalogued-but-unused service really did report nothing, and
    // "<0.1%" would imply some usage it did not have.
    expect(formatHeadroom(0)).toBe("0%");
  });

  it("uses one decimal at and above 1%", () => {
    expect(formatHeadroom(0.116)).toBe("11.6%");
    expect(formatHeadroom(0.01)).toBe("1.0%");
  });

  it("reports over 100% rather than clamping", () => {
    expect(formatHeadroom(1.37)).toBe("137.0%");
  });
});

describe("number formatting is locale-pinned", () => {
  // Not the runtime default: the worker runs one locale and the browser
  // another, and a number formatted differently on the two sides of SSR
  // is a hydration mismatch.
  it("groups thousands the en-US way regardless of environment", () => {
    expect(formatQuantity(338711)).toBe("338,711");
  });

  it("renders cents as USD", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(1234)).toBe("$12.34");
  });
});
