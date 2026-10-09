/**
 * The club season: which club year an instant falls in.
 *
 * A season runs **Aug 1 → Jul 31** Cincinnati-local (see
 * {@link CLUB_TIME_ZONE}) and is labelled `"YYYY-YY"` — the same format
 * `historical_officers.school_year` already stores.
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

  const startYear = openedThisYear ? zoned.year : zoned.year - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}
