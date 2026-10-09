import { describe, expect, it } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import type { CalendarOccurrence } from "#/features/calendar/server/calendar-fns";
import {
  clubDateOf,
  fromPickerDate,
  groupByClubDate,
  monthWindow,
  startOfClubDay,
  toPickerDate,
} from "#/features/calendar/lib/calendar-window";

function clubLocal(local: string): Temporal.Instant {
  return Temporal.PlainDateTime.from(local)
    .toZonedDateTime(CLUB_TIME_ZONE)
    .toInstant();
}

function occurrence(
  startsAt: Temporal.Instant,
  endsAt: Temporal.Instant | null = null,
  publicId = "evt1",
): CalendarOccurrence {
  return {
    eventId: `id-${publicId}`,
    publicId,
    occurrenceStart: startsAt,
    startsAt,
    endsAt,
    allDay: false,
    title: "Event",
    description: null,
    location: null,
    kind: "meeting",
    visibility: "members",
    rrule: null,
    seriesStartsAt: startsAt,
    seriesEndsAt: null,
    seriesCanceled: false,
    occurrenceCanceled: false,
    canceled: false,
    sequence: 0,
    updatedAt: startsAt,
  };
}

describe("clubDateOf", () => {
  /**
   * The whole reason these helpers exist. 2026-05-07T01:00Z is still
   * May 6 in Cincinnati; a UTC reading puts the club's Wednesday
   * meeting on Thursday, and a viewer-zone reading puts it somewhere
   * different again for every member.
   */
  it("reads the club's calendar day, not UTC's", () => {
    expect(
      clubDateOf(Temporal.Instant.from("2026-05-07T01:00:00Z")).toString(),
    ).toBe("2026-05-06");
  });

  it("round-trips club-local midnight", () => {
    const date = Temporal.PlainDate.from("2026-05-06");
    expect(clubDateOf(startOfClubDay(date)).toString()).toBe("2026-05-06");
  });

  it("puts club midnight at 04:00Z in summer and 05:00Z in winter", () => {
    expect(
      startOfClubDay(Temporal.PlainDate.from("2026-07-01")).toString(),
    ).toBe("2026-07-01T04:00:00Z");
    expect(
      startOfClubDay(Temporal.PlainDate.from("2026-01-01")).toString(),
    ).toBe("2026-01-01T05:00:00Z");
  });
});

describe("monthWindow", () => {
  /**
   * The grid renders the tail of the previous month and the head of the
   * next, so the window is padded. Fetching the bare month leaves those
   * cells blank and an event only appears once the reader pages to it.
   */
  it("pads a week either side of the month", () => {
    const { from, until } = monthWindow(
      Temporal.PlainYearMonth.from("2026-05"),
    );
    expect(clubDateOf(from).toString()).toBe("2026-04-24");
    expect(clubDateOf(until).toString()).toBe("2026-06-08");
  });

  it("handles a December window rolling into the next year", () => {
    const { until } = monthWindow(Temporal.PlainYearMonth.from("2026-12"));
    expect(clubDateOf(until).toString()).toBe("2027-01-08");
  });

  it("spans a DST transition without losing a day", () => {
    const { from, until } = monthWindow(
      Temporal.PlainYearMonth.from("2026-11"),
    );
    expect(clubDateOf(from).toString()).toBe("2026-10-25");
    expect(clubDateOf(until).toString()).toBe("2026-12-08");
  });
});

describe("groupByClubDate", () => {
  it("buckets a single-day event under its club date", () => {
    const grouped = groupByClubDate([
      occurrence(clubLocal("2026-05-06T18:00")),
    ]);
    expect([...grouped.keys()]).toEqual(["2026-05-06"]);
  });

  /**
   * A late-evening event is still that day's. Bucketing off the raw
   * instant would file a 21:00 meeting under the next day for half the
   * year.
   */
  it("keeps a late-evening event on its own club date", () => {
    const grouped = groupByClubDate([
      occurrence(clubLocal("2026-05-06T21:30")),
    ]);
    expect([...grouped.keys()]).toEqual(["2026-05-06"]);
  });

  /**
   * A weekend trip has to show on every day of the grid it covers, not
   * only the day it departs — otherwise Saturday and Sunday read as
   * free.
   */
  it("spans a multi-day event across every day it covers", () => {
    const grouped = groupByClubDate([
      occurrence(clubLocal("2026-05-08T17:00"), clubLocal("2026-05-10T15:00")),
    ]);
    expect([...grouped.keys()].sort()).toEqual([
      "2026-05-08",
      "2026-05-09",
      "2026-05-10",
    ]);
  });

  it("collects several events on one day", () => {
    const grouped = groupByClubDate([
      occurrence(clubLocal("2026-05-06T18:00"), null, "a"),
      occurrence(clubLocal("2026-05-06T20:00"), null, "b"),
    ]);
    expect(grouped.get("2026-05-06")).toHaveLength(2);
  });

  it("returns an empty map for no occurrences", () => {
    expect(groupByClubDate([]).size).toBe(0);
  });
});

describe("picker date conversion", () => {
  /**
   * DayPicker is a `Date`-and-browser-zone boundary. Building its Date
   * from the date's own components keeps the calendar-day identity
   * whatever zone the viewer is in — the cell labelled "6" has to be
   * the club's 6th.
   */
  it("round-trips a plain date through the picker's Date", () => {
    const date = Temporal.PlainDate.from("2026-05-06");
    expect(fromPickerDate(toPickerDate(date)).toString()).toBe("2026-05-06");
  });

  it("round-trips across a DST boundary", () => {
    for (const iso of ["2026-03-08", "2026-11-01"]) {
      const date = Temporal.PlainDate.from(iso);
      expect(fromPickerDate(toPickerDate(date)).toString()).toBe(iso);
    }
  });

  it("builds a local-midnight Date for the right day", () => {
    const picker = toPickerDate(Temporal.PlainDate.from("2026-05-06"));
    expect(picker.getFullYear()).toBe(2026);
    expect(picker.getMonth()).toBe(4);
    expect(picker.getDate()).toBe(6);
  });
});
