import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  formatRelative,
  toDateInputValue,
} from "#/lib/date-format";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("formatRelative", () => {
  // Locale-pinned to "en" inside the helper, so phrasing is deterministic.
  it("describes a past instant", () => {
    const threeDaysAgo = Temporal.Instant.fromEpochMilliseconds(
      Date.now() - 3 * DAY_MS,
    );
    expect(formatRelative(threeDaysAgo)).toBe("3 days ago");
  });

  it("describes a future instant", () => {
    const inTwoHours = Temporal.Instant.fromEpochMilliseconds(
      Date.now() + 2 * HOUR_MS,
    );
    expect(formatRelative(inTwoHours)).toBe("in 2 hours");
  });

  it("collapses sub-minute deltas to 'just now'", () => {
    expect(formatRelative(Temporal.Now.instant())).toBe("just now");
  });
});

describe("toDateInputValue", () => {
  it("extracts the UTC calendar date by default", () => {
    expect(
      toDateInputValue(Temporal.Instant.from("2026-03-05T12:00:00Z")),
    ).toBe("2026-03-05");
  });

  it("honors an explicit zone (late-evening UTC is the prior local day)", () => {
    // 2026-03-05T02:00Z is 2026-03-04 21:00 in America/New_York (EST).
    expect(
      toDateInputValue(
        Temporal.Instant.from("2026-03-05T02:00:00Z"),
        "America/New_York",
      ),
    ).toBe("2026-03-04");
  });
});

describe("absolute formatters", () => {
  // Locale/zone of the runtime can vary, so assert structure, not exact
  // punctuation: both must render the year and be non-empty.
  const instant = Temporal.Instant.from("2026-03-05T15:30:00Z");

  it("formatDate includes the year", () => {
    expect(formatDate(instant)).toContain("2026");
  });

  it("formatDateTime includes the year", () => {
    expect(formatDateTime(instant)).toContain("2026");
  });
});
