/**
 * Club-season helper. UCMC's paper waiver is re-collected every fall
 * semester; the season identifier (`"YYYY-YY"`) ties an attestation row
 * to the academic year it covers.
 *
 * Rollover happens at midnight **Cincinnati-local** (America/New_York) on
 * Aug 21 — see {@link CLUB_TIME_ZONE}. Members attested under the prior
 * season stop satisfying the `requireCurrentWaiver` guard from that
 * moment; they need a fresh paper waiver and a new attestation.
 *
 * Pure module so it's safe to import from server fns, route loaders, and
 * tests. Does not read any environment, db, or request state.
 */
import { CLUB_TIME_ZONE } from "#/config/time";

/**
 * The day a new season begins. Stored as 1-indexed month + day to match
 * how a human reads a calendar. Aug 21 = `{ month: 8, day: 21 }`.
 *
 * If UCMC ever moves the rollover (e.g. a different academic-year start
 * at UC), change this here and bump `WAIVER_VERSION` so existing
 * attestations don't accidentally satisfy the guard for the new season.
 */
export const CLUB_SEASON_START = { month: 8, day: 21 } as const;

/**
 * Returns the season identifier for `now` formatted as `"YYYY-YY"` (e.g.
 * `"2025-26"`). Anything before Aug 21 of year N belongs to season
 * `(N-1)-N`; anything on/after Aug 21 belongs to season `N-(N+1)`.
 *
 * `now` defaults to "right now" so callers can usually call without args.
 * Tests pass a fixed `Date` to exercise rollover boundaries.
 */
export function currentSeason(
  now: Temporal.Instant = Temporal.Now.instant(),
): string {
  // Rollover is a Cincinnati-local calendar boundary, so read the
  // year/month/day in the club zone rather than UTC.
  const zoned = now.toZonedDateTimeISO(CLUB_TIME_ZONE);
  const year = zoned.year;
  const month = zoned.month;
  const day = zoned.day;

  const beforeCutoff =
    month < CLUB_SEASON_START.month ||
    (month === CLUB_SEASON_START.month && day < CLUB_SEASON_START.day);

  const startYear = beforeCutoff ? year - 1 : year;
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(2)}`;
}
