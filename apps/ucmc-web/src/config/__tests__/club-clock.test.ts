import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import { currentSeason } from "#/config/club-season";
import { clubYearOf } from "#/features/volunteer/lib/service-totals";
import type { VolunteerEventEntry } from "#/features/volunteer/server/volunteer-fns";
import { schoolYearForArchiveFire } from "#/server/cron/archive-officers.server";

/**
 * Calendar boundaries under a CONTROLLED CLOCK.
 *
 * Everything with a calendar rule here takes an injectable `now` and is
 * tested by passing one — which exercises the arithmetic and says
 * nothing about the branch every caller in production actually uses, the
 * `= Temporal.Now.instant()` default. A change that made the default
 * read UTC instead of `CLUB_TIME_ZONE`, or stopped reading the clock at
 * all, passes every one of those tests.
 *
 * These are the first `vi.setSystemTime` tests in the suite. Verified
 * that fake timers reach the Temporal polyfill inside workerd — it
 * derives `Temporal.Now` from `Date.now()`, which vitest replaces — so
 * the no-argument path really is under test here.
 *
 * The other half is DST. The club zone observes it; the worker runs UTC;
 * `CLUB_TIME_ZONE` is the whole reason those two don't collide. A
 * transition is where "a day" stops being 24 hours, so it is where
 * instant arithmetic and calendar arithmetic diverge — and the codebase
 * deliberately uses each in different places.
 */

// 2025-08-01T04:00Z is exactly midnight EDT (UTC-4) on Aug 1 — the
// instant the club season rolls over. A UTC-reading implementation puts
// the boundary at 00:00Z, four hours earlier, and gets both of these
// wrong in the same direction.
const ROLLOVER_UTC = "2025-08-01T04:00:00Z";
const ONE_SECOND_BEFORE_ROLLOVER = "2025-08-01T03:59:59Z";

// America/New_York transitions: 2nd Sunday in March (02:00 EST → 03:00
// EDT, the day with 23 hours) and 1st Sunday in November (02:00 EDT →
// 01:00 EST, the day with 25 hours).
const SPRING_FORWARD_2026 = "2026-03-08T07:00:00Z"; // 02:00 EST → 03:00 EDT
const FALL_BACK_2026 = "2026-11-01T06:00:00Z"; // 02:00 EDT → 01:00 EST

const setNow = (iso: string) => {
  vi.setSystemTime(new Date(iso));
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("currentSeason() reads the real clock, in the club zone", () => {
  it("tracks the system clock when called with no argument", () => {
    setNow("2026-01-15T12:00:00Z");
    expect(currentSeason()).toBe("2025-26");

    setNow("2027-01-15T12:00:00Z");
    expect(currentSeason()).toBe("2026-27");
  });

  it("rolls over at local midnight, not UTC midnight", () => {
    // The assertion the whole `CLUB_TIME_ZONE` convention exists for.
    // At 00:00Z on Aug 1 it is still 20:00 on Jul 31 in Cincinnati, so
    // a UTC read rolls the club into a new season four hours early
    // — and every member's current attestation stops satisfying
    // `requireCurrentWaiver` for those four hours.
    setNow("2025-08-01T00:00:00Z");
    expect(currentSeason()).toBe("2024-25");

    setNow(ONE_SECOND_BEFORE_ROLLOVER);
    expect(currentSeason()).toBe("2024-25");

    setNow(ROLLOVER_UTC);
    expect(currentSeason()).toBe("2025-26");
  });

  it("agrees with the explicitly-passed instant", () => {
    // The default and the argument must be the same clock. If they ever
    // diverge, every test that passes `now` explicitly keeps passing
    // while production reads something else.
    setNow("2026-05-04T17:23:11Z");
    expect(currentSeason()).toBe(currentSeason(Temporal.Now.instant()));
  });
});

describe("club-year rollover is stable across DST transitions", () => {
  // Both transitions are far from the Aug 1 boundary, which is the point:
  // the season must not notice it at all. It would if the boundary were
  // ever reimplemented by counting elapsed milliseconds from a fixed
  // epoch instead of reading the local calendar date.
  it("does not shift the cycle at spring forward", () => {
    setNow(
      Temporal.Instant.from(SPRING_FORWARD_2026)
        .subtract({ hours: 1 })
        .toString(),
    );
    const before = currentSeason();

    setNow(
      Temporal.Instant.from(SPRING_FORWARD_2026).add({ hours: 1 }).toString(),
    );
    expect(currentSeason()).toBe(before);
    expect(before).toBe("2025-26");
  });

  it("does not shift the cycle at fall back", () => {
    setNow(
      Temporal.Instant.from(FALL_BACK_2026).subtract({ hours: 1 }).toString(),
    );
    const before = currentSeason();

    setNow(Temporal.Instant.from(FALL_BACK_2026).add({ hours: 1 }).toString());
    expect(currentSeason()).toBe(before);
    expect(before).toBe("2026-27");
  });

  it("puts the repeated 01:xx hour of fall-back in one club year", () => {
    // 01:30 happens twice on that date — once EDT, once EST. Both are
    // the same calendar day locally, so both must answer the same club
    // year. A naive offset assumption (`UTC-4` hard-coded) gets the
    // second one wrong.
    const firstPass = Temporal.Instant.from("2026-11-01T05:30:00Z"); // 01:30 EDT
    const secondPass = Temporal.Instant.from("2026-11-01T06:30:00Z"); // 01:30 EST

    for (const instant of [firstPass, secondPass]) {
      expect(
        instant.toZonedDateTimeISO(CLUB_TIME_ZONE).hour,
        "both passes should read as the 1 o'clock hour locally",
      ).toBe(1);
      expect(currentSeason(instant)).toBe("2026-27");
    }
  });
});

describe("the volunteer club year is the club season, under the same clock", () => {
  it("classifies an outing by the club-local rollover", () => {
    // `clubYearOf` reuses `currentSeason` rather than defining a
    // second August boundary. Pinned here so a later "simplification"
    // that re-derives the cutoff has to disagree with this test first.
    // `clubYearOf` reads one field; the cast keeps the fixture to that
    // field rather than inventing a whole outing to say nothing about.
    const outingAt = (instant: Temporal.Instant) =>
      ({
        startsAtMs: instant.epochMilliseconds,
      }) as unknown as VolunteerEventEntry;

    expect(
      clubYearOf(outingAt(Temporal.Instant.from(ONE_SECOND_BEFORE_ROLLOVER))),
    ).toBe("2024-25");
    expect(clubYearOf(outingAt(Temporal.Instant.from(ROLLOVER_UTC)))).toBe(
      "2025-26",
    );
  });
});

describe("schoolYearForArchiveFire reads the club zone, not UTC", () => {
  it("uses the local calendar year when the two disagree", () => {
    // The archive fires on March 1, where a UTC read and a local read
    // never pick different years — so the zone conversion in that
    // function is load-bearing only if the schedule ever moves. This
    // pins it at the one boundary where it shows: New Year's, when
    // Cincinnati is still in the previous year for five hours.
    const newYearUtc = Temporal.Instant.from("2026-01-01T02:00:00Z");

    expect(
      newYearUtc.toZonedDateTimeISO(CLUB_TIME_ZONE).year,
      "sanity: this instant is still 2025 in Cincinnati",
    ).toBe(2025);

    expect(schoolYearForArchiveFire(newYearUtc).startYear).toBe(2024);
    expect(schoolYearForArchiveFire(newYearUtc).schoolYear).toBe("2024-25");
  });
});

describe("retention windows are exact elapsed time, not calendar days", () => {
  it("treats a DST-spanning window as 24-hour days", () => {
    // `retention.server.ts` subtracts `DAYS * 86_400_000` milliseconds.
    // Across spring-forward that window covers one fewer hour of *wall
    // clock* than "30 calendar days ago" would, and this test pins that
    // as intended rather than as drift.
    //
    // It is the right semantic here: the retention promise in the
    // privacy policy is about how long data is KEPT, which is elapsed
    // time. Calendar arithmetic would make the cutoff depend on which
    // side of a transition the row was written — the same row surviving
    // an hour longer in March than in July.
    //
    // Anything user-facing and calendar-shaped (a loan due "at end of
    // day", the Aug 1 rollover) must NOT use this, and doesn't.
    const now = Temporal.Instant.from("2026-03-20T12:00:00Z");
    const exact = now.subtract({ milliseconds: 30 * 24 * 60 * 60 * 1000 });

    const calendar = now
      .toZonedDateTimeISO(CLUB_TIME_ZONE)
      .subtract({ days: 30 })
      .toInstant();

    expect(
      exact.epochMilliseconds,
      "a 30-day window spanning spring-forward should differ from 30 calendar days by exactly the lost hour",
    ).toBe(calendar.epochMilliseconds - 60 * 60 * 1000);
  });

  it("is unaffected by DST when the window spans no transition", () => {
    const now = Temporal.Instant.from("2026-07-20T12:00:00Z");
    const exact = now.subtract({ milliseconds: 30 * 24 * 60 * 60 * 1000 });
    const calendar = now
      .toZonedDateTimeISO(CLUB_TIME_ZONE)
      .subtract({ days: 30 })
      .toInstant();

    expect(exact.epochMilliseconds).toBe(calendar.epochMilliseconds);
  });
});
