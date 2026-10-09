/**
 * How far through their season a member is.
 *
 * The profile draws one closed ring per season a member has
 * **finished**, plus a partial arc for the one they are in — so a
 * first-year member has no ring yet, someone starting their second
 * season has exactly one, and someone a quarter of the way through
 * their third has two rings and a 25% arc.
 *
 * Two anchors, and neither is the waiver cycle's own Aug 21 → Aug 20
 * span:
 *
 * - **Start is the day the member attested**, not the day the cycle
 *   opened. Someone who joins in January is a third of the way into
 *   the club year but zero of the way into *their* season, and an arc
 *   that starts them at 35% is measuring the calendar rather than
 *   them.
 * - **The finish line is May 1**, when the spring semester ends. The
 *   club year nominally runs to August, but nothing happens over the
 *   summer, so an arc crawling through June and July would report a
 *   season as unfinished months after it was.
 *
 * A ring closes at exactly the moment its arc fills, because
 * `seasonComplete` uses the same May 1 boundary that `seasonProgress`
 * divides by. Between May 1 and the August rollover a member has a
 * closed ring and no arc, which is the honest picture: last season is
 * done and next season has not opened.
 *
 * Pure, and the clock is a parameter, so Stryker can mutate it (see
 * `stryker.config.json`). A boundary off by a day here is invisible
 * on screen and wrong for a week every spring.
 */

import { CLUB_TIME_ZONE } from "#/config/time";

/**
 * End of the spring semester, give or take — the day a club year's
 * season is considered served. Stored 1-indexed to read like a
 * calendar, matching `WAIVER_CYCLE_CUTOFF`.
 */
export const SEASON_END_CUTOFF = { month: 5, day: 1 } as const;

/**
 * Midnight Cincinnati-local on the May 1 that closes a `"YYYY-YY"`
 * cycle.
 *
 * Reads the END year off the cycle string: cycle `"2025-26"` opens in
 * August 2025 and closes on 2026-05-01.
 */
export function seasonEnd(cycle: string): Temporal.ZonedDateTime {
  // `slice` before `parseInt` is deliberate even though `parseInt`
  // would stop at the dash on its own: it is what makes the field
  // width explicit, and it is the difference between 2025 and 20251
  // if a malformed cycle ever reaches here. Mutation testing reports
  // dropping it as a surviving (equivalent) mutant for well-formed
  // input, which is expected — don't "simplify" it away.
  const startYear = Number.parseInt(cycle.slice(0, 4), 10);
  return Temporal.ZonedDateTime.from({
    timeZone: CLUB_TIME_ZONE,
    year: startYear + 1,
    month: SEASON_END_CUTOFF.month,
    day: SEASON_END_CUTOFF.day,
  });
}

/** Whether a cycle's season has run its course. */
export function seasonComplete(cycle: string, now: Temporal.Instant): boolean {
  return now.epochMilliseconds >= seasonEnd(cycle).epochMilliseconds;
}

/**
 * Fraction of a member's season elapsed, in `[0, 1]`.
 *
 * @param attestedAt when they signed on for this cycle — the arc's
 *   zero point.
 * @param cycle the `"YYYY-YY"` cycle being measured.
 *
 * Returns 1 for a member who attested after the finish line had
 * already passed, rather than a negative or runaway fraction: they
 * are paid up for a season that is over, and `seasonComplete` will
 * agree it is behind them.
 */
export function seasonProgress(
  attestedAt: Temporal.Instant,
  cycle: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): number {
  const end = seasonEnd(cycle).epochMilliseconds;
  const start = attestedAt.epochMilliseconds;

  if (start >= end) {
    return 1;
  }

  return Math.min(
    1,
    Math.max(0, (now.epochMilliseconds - start) / (end - start)),
  );
}
