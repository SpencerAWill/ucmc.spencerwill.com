/**
 * The club season: which club year an instant falls in, and how a season
 * subdivides for reporting.
 *
 * A season runs **Aug 1 → Jul 31** Cincinnati-local (see
 * {@link CLUB_TIME_ZONE}) and is labelled `"YYYY-YY"` — the same format
 * `historical_officers.school_year` already stores, though **only the
 * format is shared**. That column denotes an executive term, which
 * Bylaws §2.1 and §2.4 run from the first week of Summer Semester for
 * one year — roughly May → May, offset about three months from a
 * season. Don't join the two as if they were the same window.
 *
 * **The waiver term is the season.** An attestation is stamped
 * `cycle = currentSeason()` at attest time, which covers the member
 * through Jul 31 and stops satisfying the `requireCurrentWaiver` guard
 * the moment the next season opens; they then need a fresh paper waiver
 * and a new attestation. Signing mid-season still covers the whole
 * season, because the stamp is taken when they sign: someone back from
 * fall co-op who signs in January gets the season that opened the
 * previous August.
 *
 * Aug 1 is deliberately **not** a guess at UC's first day of classes.
 * The boundary used to sit on Aug 21, a fake-precise proxy for a date
 * that moves every year — approximately right most years and exactly
 * right in none. Classes start in the last week of August, but club
 * trips can go out earlier in the month, so the season has to open
 * before the semester does. A clean month boundary is both earlier than
 * any trip and stable.
 *
 * Pure module so it's safe to import from server fns, route loaders, and
 * tests. Does not read any environment, db, or request state.
 */
import { CLUB_TIME_ZONE } from "#/config/time";

/** A season is a full calendar year, just not one starting in January. */
const MONTHS_PER_SEASON = 12;

/**
 * Half-open range, `[start, end)` — the convention the DB query bounds
 * already use (`gte` / `lt`), and the only one under which consecutive
 * periods tile without double-counting the instant they meet.
 */
interface ClubRange {
  start: Temporal.ZonedDateTime;
  end: Temporal.ZonedDateTime;
}

/**
 * The day a new season opens. Stored as 1-indexed month + day to match
 * how a human reads a calendar. Aug 1 = `{ month: 8, day: 1 }`.
 *
 * Moving this **later** needs a `WAIVER_VERSION` bump, so attestations
 * written under the old rule can't accidentally satisfy the guard for a
 * season they weren't signed for. Moving it **earlier** does not: the
 * guard gets strictly stricter, and a bump would invalidate every live
 * attestation — `requireCurrentWaiver` filters on `version` as well as
 * `cycle` — and force the whole club to re-sign for nothing.
 */
export const CLUB_SEASON_START = { month: 8, day: 1 } as const;

/** Midnight Cincinnati-local on the Aug 1 that opens `calendarYear`'s season. */
function seasonOpening(calendarYear: number): Temporal.ZonedDateTime {
  return Temporal.ZonedDateTime.from({
    timeZone: CLUB_TIME_ZONE,
    year: calendarYear,
    month: CLUB_SEASON_START.month,
    day: CLUB_SEASON_START.day,
  });
}

/**
 * Returns the season identifier for `now` formatted as `"YYYY-YY"` (e.g.
 * `"2025-26"`). Anything before Aug 1 of year N belongs to season
 * `(N-1)-N`; anything on/after Aug 1 belongs to season `N-(N+1)`.
 *
 * `now` defaults to "right now" so callers can usually call without args.
 * Tests pass a fixed instant to exercise rollover boundaries.
 */
export function currentSeason(
  now: Temporal.Instant = Temporal.Now.instant(),
): string {
  // Rollover is a Cincinnati-local calendar boundary, so compare local
  // wall time against the local opening rather than reading calendar
  // fields off a raw instant — the worker runs UTC and would roll the
  // whole club into a new season 4–5 hours early.
  const zoned = now.toZonedDateTimeISO(CLUB_TIME_ZONE);
  const openedThisYear =
    Temporal.ZonedDateTime.compare(zoned, seasonOpening(zoned.year)) >= 0;

  return seasonLabel(openedThisYear ? zoned.year : zoned.year - 1);
}

/**
 * `"2025-26"` → `2025`.
 *
 * `slice` before `parseInt` is deliberate even though `parseInt` would
 * stop at the dash on its own: it makes the field width explicit, and it
 * is the difference between 2025 and 20251 if a malformed season label
 * ever reaches here. Same reasoning as its sibling in
 * `server/member-profile/season-progress.ts`, and the same surviving
 * (equivalent) mutant: for well-formed labels dropping the `slice`
 * changes nothing, which is expected — don't "simplify" it away.
 */
function seasonStartYear(season: string): number {
  return Number.parseInt(season.slice(0, 4), 10);
}

/** `2025` → `"2025-26"`. */
function seasonLabel(startYear: number): string {
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

/**
 * The half-open instant range a `"YYYY-YY"` season covers: Aug 1 of its
 * first year up to, but not including, Aug 1 of its second.
 */
export function seasonBoundsFor(season: string): ClubRange {
  const startYear = seasonStartYear(season);
  return { start: seasonOpening(startYear), end: seasonOpening(startYear + 1) };
}

/**
 * Every season label touched by `[from, to]`, oldest first — including
 * both endpoints' own seasons, and every season in between even if
 * nothing happened in it. A reporting axis needs the gap drawn, not
 * skipped.
 *
 * Returns `[]` when `to` precedes `from`, rather than guessing which way
 * round the caller meant them.
 */
export function seasonsBetween(
  from: Temporal.Instant,
  to: Temporal.Instant,
): string[] {
  const firstYear = seasonStartYear(currentSeason(from));
  const lastYear = seasonStartYear(currentSeason(to));
  // Stated rather than relied upon, and Stryker reports both mutations
  // of it as surviving — `Array.from({ length: -2 })` is already `[]`,
  // because `length` is coerced through ToLength. That coercion is not
  // something a reader of this function should have to know, so the
  // guard stays and the equivalent mutants are expected.
  if (lastYear < firstYear) {
    return [];
  }
  return Array.from({ length: lastYear - firstYear + 1 }, (_, offset) =>
    seasonLabel(firstYear + offset),
  );
}

/**
 * Where `now` falls within its season: the label, plus how many whole
 * months into the season it is — **0 = August**, 11 = July.
 *
 * The month index is what lets two seasons be drawn on one shared axis
 * without January appearing to come before August.
 */
export function seasonOffsetOf(
  now: Temporal.Instant = Temporal.Now.instant(),
): { season: string; monthIndex: number } {
  const month = now.toZonedDateTimeISO(CLUB_TIME_ZONE).month;
  return {
    season: currentSeason(now),
    monthIndex:
      (month - CLUB_SEASON_START.month + MONTHS_PER_SEASON) % MONTHS_PER_SEASON,
  };
}

interface SemesterMeta {
  /** How it reads on a report. */
  label: string;
  /** 1-indexed calendar month the period opens on. */
  startMonth: number;
  /**
   * How many months it spans. **Not equal across the three** — Fall is 5,
   * Spring 4, Summer 3 — so any per-month rate (trips per month, gear
   * loans per month) has to divide by this rather than assume equal
   * thirds. A bar chart of raw semester totals makes Fall look busier
   * than it is for free.
   */
  monthCount: number;
}

/**
 * The three reporting periods a season divides into.
 *
 * **These approximate semesters; they are not UC's academic calendar.**
 * The real one is week-shaped and published yearly — fall runs roughly
 * the last week of August to the first week of December, spring from the
 * first or second week of January to the last week of April, summer
 * through the last week of July — and critically it has **gaps that
 * belong to no semester at all**, winter break above all. There is no
 * rule that predicts those dates; they are data UC publishes.
 *
 * Month boundaries are the right choice anyway, because a reporting
 * bucket has to be a **total partition of the season**: every gear loan,
 * trip and activity day must land in exactly one bucket, or a season
 * report stops summing to the season. Real term dates would strand
 * anything happening over winter break, which for a mountaineering club
 * is not hypothetical. Under this split, December break activity counts
 * as Fall and January break activity as Spring.
 *
 * If true academic precision is ever wanted — engagement during term vs.
 * during break — that is an `academic_terms` table of hand-entered
 * published dates, and a separate feature. It is not a reason to make
 * this partition leaky.
 *
 * `SEASON_END_CUTOFF` in `server/member-profile/season-progress.ts` sits
 * on the same May 1 as the Spring/Summer boundary here, and is kept
 * separate on purpose — see its doc comment.
 */
export const SEMESTERS = {
  fall: { label: "Fall", startMonth: 8, monthCount: 5 },
  spring: { label: "Spring", startMonth: 1, monthCount: 4 },
  summer: { label: "Summer", startMonth: 5, monthCount: 3 },
} as const satisfies Record<string, SemesterMeta>;

export type Semester = keyof typeof SEMESTERS;

/** Season order — Fall opens the season, Summer closes it. */
export const SEMESTER_ORDER = [
  "fall",
  "spring",
  "summer",
] as const satisfies readonly Semester[];

/**
 * `monthIndex` (0 = August) → the semester that month belongs to.
 *
 * Built from `monthCount` rather than written out, so the lookup cannot
 * drift from the registry above. Totality is pinned by test rather than
 * by types: the three counts summing to 12 is what makes every index
 * resolvable.
 */
const SEMESTER_BY_MONTH_INDEX: readonly Semester[] = SEMESTER_ORDER.flatMap(
  (semester) =>
    Array.from({ length: SEMESTERS[semester].monthCount }, () => semester),
);

/** Which season and reporting period `now` falls in. */
export function semesterOf(now: Temporal.Instant = Temporal.Now.instant()): {
  season: string;
  semester: Semester;
} {
  const { season, monthIndex } = seasonOffsetOf(now);
  return { season, semester: SEMESTER_BY_MONTH_INDEX[monthIndex] };
}

/**
 * The half-open instant range one reporting period of one season covers.
 *
 * The three tile their season exactly — Fall opens on the season's own
 * boundary, Summer ends on the next one — which holds because the season
 * opens on the 1st of a month. `club-season.test.ts` asserts the tiling
 * rather than trusting it, so moving `CLUB_SEASON_START` off the 1st
 * fails loudly here instead of silently dropping days out of every
 * season report.
 */
export function semesterBoundsFor(
  season: string,
  semester: Semester,
): ClubRange {
  const { startMonth, monthCount } = SEMESTERS[semester];
  // A period opening at or after the season's own opening month falls in
  // the season's FIRST calendar year; one opening earlier in the
  // calendar falls in its second. Derived from CLUB_SEASON_START so
  // moving the season boundary carries these with it.
  const startYear = seasonStartYear(season);
  const start = Temporal.ZonedDateTime.from({
    timeZone: CLUB_TIME_ZONE,
    year: startMonth >= CLUB_SEASON_START.month ? startYear : startYear + 1,
    month: startMonth,
    day: 1,
  });
  return { start, end: start.add({ months: monthCount }) };
}
