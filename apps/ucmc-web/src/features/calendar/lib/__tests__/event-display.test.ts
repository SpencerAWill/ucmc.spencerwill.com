import { describe, expect, it } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import {
  EVENT_KIND_LABEL,
  formatClubDayHeading,
  formatClubMonthHeading,
  formatClubTime,
  formatClubTimeRange,
} from "#/features/calendar/lib/event-display";

function clubLocal(local: string): Temporal.Instant {
  return Temporal.PlainDateTime.from(local)
    .toZonedDateTime(CLUB_TIME_ZONE)
    .toInstant();
}

describe("formatClubMonthHeading", () => {
  /**
   * **The regression this exists for.**
   * `Temporal.PlainYearMonth.prototype.toLocaleString` throws
   * `RangeError: Mismatched calendars` when the object's calendar
   * (iso8601) differs from the locale's resolved one — and `en-US`
   * resolves to `gregory`. It threw during render, so it took down the
   * whole page rather than one heading.
   */
  it("formats a month without throwing on the calendar mismatch", () => {
    expect(
      formatClubMonthHeading(Temporal.PlainYearMonth.from("2026-05")),
    ).toBe("May 2026");
  });

  it("formats every month of a year", () => {
    for (let month = 1; month <= 12; month += 1) {
      const yearMonth = Temporal.PlainYearMonth.from({ year: 2026, month });
      expect(() => formatClubMonthHeading(yearMonth)).not.toThrow();
    }
  });

  it("carries the year across a boundary", () => {
    expect(
      formatClubMonthHeading(Temporal.PlainYearMonth.from("2027-01")),
    ).toBe("January 2027");
  });
});

describe("formatClubDayHeading", () => {
  it("names the weekday and date", () => {
    expect(formatClubDayHeading(Temporal.PlainDate.from("2026-05-06"))).toBe(
      "Wednesday, May 6",
    );
  });

  /**
   * `PlainDate` tolerates the iso8601/gregory mismatch that
   * `PlainYearMonth` rejects, which is why this one never had the bug.
   */
  it("does not throw on the calendar mismatch", () => {
    expect(() =>
      formatClubDayHeading(Temporal.PlainDate.from("2026-11-01")),
    ).not.toThrow();
  });
});

describe("formatClubTime", () => {
  /**
   * Club time, not the viewer's. A member in Denver needs the time the
   * club is meeting; `#/lib/date-format` would render 4:00 PM and put
   * the row under a heading that says Wednesday.
   */
  it("renders in the club zone", () => {
    expect(formatClubTime(clubLocal("2026-05-06T18:00"))).toBe("6:00 PM");
  });

  it("renders the same local time either side of a DST change", () => {
    expect(formatClubTime(clubLocal("2026-10-28T18:00"))).toBe("6:00 PM");
    expect(formatClubTime(clubLocal("2026-11-04T18:00"))).toBe("6:00 PM");
  });
});

describe("formatClubTimeRange", () => {
  it("joins a start and end", () => {
    expect(
      formatClubTimeRange(
        clubLocal("2026-05-06T18:00"),
        clubLocal("2026-05-06T19:00"),
        false,
      ),
    ).toBe("6:00 PM – 7:00 PM");
  });

  it("gives the start alone when there is no end", () => {
    expect(
      formatClubTimeRange(clubLocal("2026-05-06T18:00"), null, false),
    ).toBe("6:00 PM");
  });

  it("says All day regardless of the stored times", () => {
    expect(
      formatClubTimeRange(
        clubLocal("2026-05-06T00:00"),
        clubLocal("2026-05-06T23:59"),
        true,
      ),
    ).toBe("All day");
  });
});

describe("EVENT_KIND_LABEL", () => {
  it("names every kind", () => {
    expect(Object.values(EVENT_KIND_LABEL).every((v) => v.length > 0)).toBe(
      true,
    );
  });
});
