import { describe, expect, it } from "vitest";

import {
  SEMESTER_ORDER,
  SEMESTERS,
  currentSeason,
  seasonBoundsFor,
  seasonOffsetOf,
  seasonsBetween,
  semesterBoundsFor,
  semesterOf,
} from "#/config/club-season";
import { CLUB_TIME_ZONE } from "#/config/time";

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

const at = (iso: string) => Temporal.Instant.from(iso);

describe("seasonBoundsFor", () => {
  it("spans Aug 1 to the following Aug 1, Cincinnati-local", () => {
    const { start, end } = seasonBoundsFor("2025-26");

    expect(start.toString()).toBe(
      "2025-08-01T00:00:00-04:00[America/New_York]",
    );
    expect(end.toString()).toBe("2026-08-01T00:00:00-04:00[America/New_York]");
  });

  it("is half-open, so consecutive seasons tile without overlapping", () => {
    // The instant one season ends is the instant the next begins, and it
    // belongs to the later one — the same `[start, end)` convention the
    // DB query bounds use. An inclusive end would double-count every
    // Aug 1 in a multi-season report.
    expect(seasonBoundsFor("2025-26").end.epochMilliseconds).toBe(
      seasonBoundsFor("2026-27").start.epochMilliseconds,
    );
    expect(currentSeason(seasonBoundsFor("2025-26").end.toInstant())).toBe(
      "2026-27",
    );
  });

  it("agrees with currentSeason on both edges", () => {
    const { start, end } = seasonBoundsFor("2025-26");

    expect(currentSeason(start.toInstant())).toBe("2025-26");
    expect(currentSeason(start.toInstant().subtract({ nanoseconds: 1 }))).toBe(
      "2024-25",
    );
    expect(currentSeason(end.toInstant().subtract({ nanoseconds: 1 }))).toBe(
      "2025-26",
    );
  });
});

describe("seasonsBetween", () => {
  it("includes both endpoints' own seasons", () => {
    expect(
      seasonsBetween(at("2024-09-01T12:00:00Z"), at("2026-03-01T12:00:00Z")),
    ).toEqual(["2024-25", "2025-26"]);
  });

  it("returns a single season when both ends fall in one", () => {
    expect(
      seasonsBetween(at("2025-08-01T12:00:00Z"), at("2026-07-01T12:00:00Z")),
    ).toEqual(["2025-26"]);
  });

  it("fills in seasons nothing happened in", () => {
    // A reporting axis needs the quiet year drawn as a gap rather than
    // skipped — otherwise two adjacent bars imply two adjacent seasons.
    expect(
      seasonsBetween(at("2022-10-01T12:00:00Z"), at("2026-01-01T12:00:00Z")),
    ).toEqual(["2022-23", "2023-24", "2024-25", "2025-26"]);
  });

  it("returns nothing when the range runs backwards", () => {
    expect(
      seasonsBetween(at("2026-01-01T12:00:00Z"), at("2024-01-01T12:00:00Z")),
    ).toEqual([]);
  });
});

describe("seasonOffsetOf", () => {
  it("numbers August 0 and July 11", () => {
    expect(seasonOffsetOf(at("2025-08-15T12:00:00Z"))).toEqual({
      season: "2025-26",
      monthIndex: 0,
    });
    expect(seasonOffsetOf(at("2026-07-15T12:00:00Z"))).toEqual({
      season: "2025-26",
      monthIndex: 11,
    });
  });

  it("puts January after August on the shared axis", () => {
    // The whole point of the offset: on a calendar-month axis January is
    // month 1 and August is month 8, so two seasons overlaid would draw
    // the spring half before the fall half that preceded it.
    const august = seasonOffsetOf(at("2025-08-15T12:00:00Z"));
    const january = seasonOffsetOf(at("2026-01-15T12:00:00Z"));

    expect(august.season).toBe(january.season);
    expect(august.monthIndex).toBeLessThan(january.monthIndex);
  });

  it("reads the month in the club zone, not UTC", () => {
    // 20:00 EDT on Jul 31 is 00:00 UTC on Aug 1 — the last month of the
    // old season, not the first of the new one.
    expect(seasonOffsetOf(at("2025-08-01T00:00:00Z"))).toEqual({
      season: "2024-25",
      monthIndex: 11,
    });
  });
});

describe("SEMESTERS", () => {
  it("partitions the season exactly, with no month in two buckets", () => {
    // The promise the whole month-boundary design rests on: a season
    // report that buckets by semester has to sum to the season.
    const months = SEMESTER_ORDER.reduce(
      (total, semester) => total + SEMESTERS[semester].monthCount,
      0,
    );
    expect(months).toBe(12);
  });

  it("assigns every month of the season to exactly one semester", () => {
    const seen = Array.from({ length: 12 }, (_, monthIndex) =>
      semesterOf(
        Temporal.ZonedDateTime.from({
          timeZone: CLUB_TIME_ZONE,
          year: 2025,
          month: 8,
          day: 15,
        })
          .add({ months: monthIndex })
          .toInstant(),
      ),
    );

    expect(seen.map((s) => s.semester)).toEqual([
      "fall",
      "fall",
      "fall",
      "fall",
      "fall",
      "spring",
      "spring",
      "spring",
      "spring",
      "summer",
      "summer",
      "summer",
    ]);
    // Every month of the season carries the SAME season label — the
    // January ones included, which is where a calendar-year bucketing
    // would split the season in half.
    expect(new Set(seen.map((s) => s.season))).toEqual(new Set(["2025-26"]));
  });

  it("is unequal on purpose, so a per-month rate must divide by its own length", () => {
    expect(SEMESTERS.fall.monthCount).toBe(5);
    expect(SEMESTERS.spring.monthCount).toBe(4);
    expect(SEMESTERS.summer.monthCount).toBe(3);
  });

  it("puts winter and spring break inside a semester rather than between them", () => {
    // UC's published calendar has gaps that belong to no term. A club
    // that climbs over winter break would lose those days entirely under
    // real term dates; here December belongs to Fall and January to
    // Spring.
    expect(semesterOf(at("2025-12-24T17:00:00Z")).semester).toBe("fall");
    expect(semesterOf(at("2026-01-02T17:00:00Z")).semester).toBe("spring");
  });
});

describe("semesterBoundsFor", () => {
  it("places Fall in the season's first calendar year and the rest in its second", () => {
    expect(semesterBoundsFor("2025-26", "fall").start.year).toBe(2025);
    expect(semesterBoundsFor("2025-26", "spring").start.year).toBe(2026);
    expect(semesterBoundsFor("2025-26", "summer").start.year).toBe(2026);
  });

  it("tiles the season end-to-end with no gap and no overlap", () => {
    // This is what makes a semester-bucketed report sum to the season.
    // It holds because the season opens on the 1st of a month; if
    // CLUB_SEASON_START ever moves off the 1st, this is the test that
    // says so rather than a report quietly losing days.
    const season = seasonBoundsFor("2025-26");
    const periods = SEMESTER_ORDER.map((semester) =>
      semesterBoundsFor("2025-26", semester),
    );

    expect(periods[0].start.epochMilliseconds).toBe(
      season.start.epochMilliseconds,
    );
    expect(periods.at(-1)?.end.epochMilliseconds).toBe(
      season.end.epochMilliseconds,
    );
    expect(periods[1].start.epochMilliseconds).toBe(
      periods[0].end.epochMilliseconds,
    );
    expect(periods[2].start.epochMilliseconds).toBe(
      periods[1].end.epochMilliseconds,
    );
  });

  it("agrees with semesterOf on each boundary instant", () => {
    for (const semester of SEMESTER_ORDER) {
      const { start, end } = semesterBoundsFor("2025-26", semester);

      expect(semesterOf(start.toInstant())).toEqual({
        season: "2025-26",
        semester,
      });
      // Half-open: the end instant is the NEXT period's first moment.
      expect(semesterOf(end.toInstant().subtract({ nanoseconds: 1 }))).toEqual({
        season: "2025-26",
        semester,
      });
    }
  });

  it("builds the boundaries in the club zone across a DST transition", () => {
    // Spring opens on Jan 1 (EST, -05:00) and closes on May 1 (EDT,
    // -04:00). A boundary built in UTC and shifted would be an hour out
    // at one end — invisible for four months and wrong for one hour.
    const { start, end } = semesterBoundsFor("2025-26", "spring");

    expect(start.toString()).toBe(
      "2026-01-01T00:00:00-05:00[America/New_York]",
    );
    expect(end.toString()).toBe("2026-05-01T00:00:00-04:00[America/New_York]");
  });
});
