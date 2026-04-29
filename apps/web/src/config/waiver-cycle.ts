/**
 * Waiver-cycle helper. UCMC's paper waiver is re-collected every fall
 * semester; the cycle identifier (`"YYYY-YY"`) ties an attestation row to
 * the academic year it covers.
 *
 * Rollover happens at midnight UTC on Aug 21. Members attested under the
 * prior cycle stop satisfying the `requireCurrentWaiver` guard from that
 * moment — they need a fresh paper waiver and a new attestation.
 *
 * Pure module so it's safe to import from server fns, route loaders, and
 * tests. Does not read any environment, db, or request state.
 */

/**
 * Cutoff at which a new cycle begins. Stored as 1-indexed month + day to
 * match how a human reads a calendar. Aug 21 = `{ month: 8, day: 21 }`.
 *
 * If UCMC ever moves the rollover (e.g. a different academic-year start at
 * UC), change this here and bump `WAIVER_VERSION` so existing attestations
 * don't accidentally satisfy the guard for the new cycle.
 */
export const WAIVER_CYCLE_CUTOFF = { month: 8, day: 21 } as const;

/**
 * Returns the cycle identifier for `now` formatted as `"YYYY-YY"` (e.g.
 * `"2025-26"`). Anything before Aug 21 of year N belongs to cycle
 * `(N-1)-N`; anything on/after Aug 21 belongs to cycle `N-(N+1)`.
 *
 * `now` defaults to "right now" so callers can usually call without args.
 * Tests pass a fixed `Date` to exercise rollover boundaries.
 */
export function currentWaiverCycle(now: Date | number = Date.now()): string {
  const date = now instanceof Date ? now : new Date(now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  const beforeCutoff =
    month < WAIVER_CYCLE_CUTOFF.month ||
    (month === WAIVER_CYCLE_CUTOFF.month && day < WAIVER_CYCLE_CUTOFF.day);

  const startYear = beforeCutoff ? year - 1 : year;
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(2)}`;
}
