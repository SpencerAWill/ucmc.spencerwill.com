import { describe, expect, it } from "vitest";

import { toDateInputValue } from "#/lib/date-format";

import { albumTakenDateToWire } from "../taken-date";

describe("albumTakenDateToWire", () => {
  it("builds UTC midnight of the calendar date", () => {
    expect(albumTakenDateToWire("2024-09-14").toISOString()).toBe(
      "2024-09-14T00:00:00.000Z",
    );
  });

  it("round-trips through toDateInputValue", () => {
    const d = albumTakenDateToWire("2024-09-14");
    expect(
      toDateInputValue(Temporal.Instant.fromEpochMilliseconds(d.getTime())),
    ).toBe("2024-09-14");
  });

  it("throws on a date that does not exist", () => {
    expect(() => albumTakenDateToWire("2024-02-30")).toThrow();
  });
});
