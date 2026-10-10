/**
 * Which date range the next snapshot run should ask for.
 *
 * Pure, so the whole backfill/trailing decision is testable without a
 * network or a database — the orchestrator just does what this says.
 *
 * ## Analytics is exempt from all of this
 *
 * {@link planSnapshotWindow} plans the BILLING window only.
 * Cloudflare's GraphQL analytics datasets hold roughly a month and
 * reject a wider range, so they are always read trailing via
 * {@link analyticsWindow} no matter which mode billing is in.
 *
 * Asking them for a backfill window used to deadlock the whole job:
 * the 90-day span below is tuned to the Billable Usage API, analytics
 * rejected it, the failure landed in `sourcesFailed`, and the
 * backfill floor is only recorded when `sourcesFailed` is empty — so
 * the mode never flipped to trailing, the window stayed 90 days, and
 * Workers, D1 and KV never produced a single row while R2 filled in
 * normally. Keep the two windows separate.
 *
 * ## Two modes
 *
 * **Trailing** is the steady state: re-read the last few days and upsert.
 * Vendor data settles after the fact (the Billable Usage API is Alpha and
 * updates daily), so a figure read once and frozen can be wrong forever
 * without anyone knowing.
 *
 * **Backfill** runs when history is missing, walking one window further
 * back per invocation. One window per run, not all of them, because the
 * daily cron shares a 30-second CPU budget with the retention sweeps and
 * the gear reminders — and this worker is already terminating a few
 * percent of ordinary requests with `exceededResources` (#272). A
 * backfill that takes three days to finish is strictly better than one
 * that takes the cron down with it.
 *
 * ## Why backfill stops on an empty window, not at a known start date
 *
 * Retention is undocumented and SHALLOWER than the subscription: on this
 * account the subscription began 2026-04-13, but a request reaching back
 * that far returns nothing before 2026-06-23 — roughly 108 days. Walking
 * back toward the subscription date would therefore re-request an empty
 * window every day forever, so the caller records a floor the first time
 * a backfill window yields nothing.
 */

/** Maximum span the Billable Usage API accepts; 92 days is rejected. */
export const MAX_RANGE_DAYS = 90;

/**
 * How far back the GraphQL analytics datasets are asked for.
 *
 * **They do not backfill, and that is a property of the API rather
 * than a choice.** The account-level datasets refuse any range wider
 * than `4w4d` outright: measured against this account on 2026-10-10,
 * a 31-day span answers for all three datasets and 32 errors with
 * `cannot request a time range wider than 4w4d`. There is no older
 * data to walk back to, so a backfill window is not merely wasteful
 * there — it is rejected.
 *
 * 30 rather than 31 leaves a day of slack: our civil dates are
 * `CLUB_TIME_ZONE` and the filter is read in UTC, so a 31-day request
 * computed late in a Cincinnati evening can land as 32 on their side
 * and trip the limit for one run a day.
 */
export const ANALYTICS_MAX_RANGE_DAYS = 30;

/**
 * How many trailing days each steady-state run re-reads and upserts.
 * Three is enough to catch a late correction without rewriting rows
 * that settled a week ago.
 */
export const TRAILING_DAYS = 3;

export interface SnapshotWindow {
  /** Civil date, inclusive. */
  from: string;
  /** Civil date, inclusive — the API's `to` bound. */
  to: string;
  mode: "backfill" | "trailing";
}

export function planSnapshotWindow(args: {
  /** Today's civil date in `CLUB_TIME_ZONE`. */
  today: string;
  /** Oldest `period_start` already snapshotted, or null when empty. */
  earliestSnapshot: string | null;
  /** Set once a backfill window came back empty — history bottoms out. */
  backfillComplete: boolean;
}): SnapshotWindow {
  const today = Temporal.PlainDate.from(args.today);

  if (args.backfillComplete) {
    return {
      from: today.subtract({ days: TRAILING_DAYS }).toString(),
      to: args.today,
      mode: "trailing",
    };
  }

  // Nothing recorded yet: take the most recent full window, so the
  // freshest data lands first and a run that never gets a second tick
  // still leaves something useful.
  if (args.earliestSnapshot === null) {
    return {
      from: today.subtract({ days: MAX_RANGE_DAYS - 1 }).toString(),
      to: args.today,
      mode: "backfill",
    };
  }

  const earliest = Temporal.PlainDate.from(args.earliestSnapshot);

  return {
    from: earliest.subtract({ days: MAX_RANGE_DAYS }).toString(),
    // Overlaps the oldest day we hold by one, so a window boundary
    // cannot fall between two days and silently skip one.
    to: earliest.toString(),
    mode: "backfill",
  };
}

/**
 * The window the analytics datasets are read over — always trailing,
 * never backfilled.
 *
 * Separate from {@link planSnapshotWindow} because it answers a
 * different question: not "what history is still missing" but "what
 * will this API serve at all". See {@link ANALYTICS_MAX_RANGE_DAYS}.
 */
export function analyticsWindow(today: string): { from: string; to: string } {
  return {
    from: Temporal.PlainDate.from(today)
      .subtract({ days: ANALYTICS_MAX_RANGE_DAYS })
      .toString(),
    to: today,
  };
}
