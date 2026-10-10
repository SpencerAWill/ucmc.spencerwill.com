/**
 * Daily cost and usage snapshot (#268).
 *
 * Rides the existing daily tick alongside the retention sweeps and gear
 * reminders, and is independent of both: a vendor outage must not stop
 * the sweeps, and a failed sweep must not cost us a day of usage data.
 *
 * ## Three sources, three failure modes
 *
 * Cloudflare billing covers only services with a paid subscription — on
 * a free-plan account that is R2 and nothing else. Workers, D1 and KV
 * usage, which is where the daily caps worth watching actually are,
 * comes from GraphQL analytics. Resend publishes no history at all, so
 * its figures are rolled up from our own send log.
 *
 * Each is gathered independently and a failure in one does not discard
 * the others: partial data beats none, and a missing row is honest
 * where a zero row would read as a true measurement of nothing.
 *
 * **Billing and analytics are read over different windows.** Billing
 * backfills; analytics cannot, because its datasets reject any range
 * wider than about a month. Sharing one window deadlocked the job —
 * see `analyticsWindow` for the mechanism.
 *
 * ## Backfill
 *
 * On a run with no history, and on each run after until a window comes
 * back empty, the planner asks for an older window instead of the
 * trailing one. One window per invocation — the cron shares a CPU
 * budget, and this worker already sheds a few percent of ordinary
 * requests to `exceededResources` (#272).
 */
import { parseAnalyticsUsage } from "#/server/cost/parse-analytics";
import {
  mergeByServiceDay,
  parseBillableUsage,
} from "#/server/cost/parse-billable-usage";
import {
  fetchAnalyticsUsage,
  fetchBillableUsage,
  costCredentials,
} from "#/server/cost/cloudflare-client.server";
import { rollUpResendSends } from "#/server/cost/resend-rollup.server";
import type { SnapshotRow } from "#/server/cost/snapshot-row";
import {
  earliestSnapshotDate,
  upsertSnapshots,
} from "#/server/cost/snapshot-store.server";
import {
  analyticsWindow,
  planSnapshotWindow,
} from "#/server/cost/snapshot-window";
import { CLUB_TIME_ZONE } from "#/config/time";
import { getKv } from "#/server/kv";
import { errorMessage, log } from "#/server/log/log.server";

/**
 * Marks that backfill reached the bottom of vendor retention.
 *
 * In KV rather than derived from the data because the signal is an
 * ABSENCE — a window that returned nothing — and absence leaves no row
 * to read next time. Without it the run would re-request the same empty
 * window every day forever. One write, once, for the life of the
 * deployment.
 */
const BACKFILL_FLOOR_KEY = "cost-snapshot:backfill-complete";

export interface CostSnapshotResult {
  skipped: boolean;
  skipReason?: "unconfigured";
  mode?: "backfill" | "trailing";
  from?: string;
  to?: string;
  rowsWritten: number;
  sourcesFailed: string[];
}

export async function runCostSnapshot(
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<CostSnapshotResult> {
  const today = now.toZonedDateTimeISO(CLUB_TIME_ZONE).toPlainDate().toString();

  // Resend's rollup needs no credentials, but a run that can only do
  // one third of the job is not worth a cron slot — and leaving the
  // credentials unset is how local dev and a fresh deploy opt out.
  if (costCredentials() === null) {
    log.info("cost.snapshot_unconfigured", {});
    return {
      skipped: true,
      skipReason: "unconfigured",
      rowsWritten: 0,
      sourcesFailed: [],
    };
  }

  const kv = getKv();
  const backfillComplete = (await kv.get(BACKFILL_FLOOR_KEY)) !== null;
  const window = planSnapshotWindow({
    today,
    earliestSnapshot: await earliestSnapshotDate(),
    backfillComplete,
  });

  const sourcesFailed: string[] = [];
  const rows: SnapshotRow[] = [];

  const billing = await fetchBillableUsage(window);
  if (billing === null) {
    sourcesFailed.push("cloudflare_billing");
  } else {
    rows.push(...mergeByServiceDay(parseBillableUsage(billing)));
  }

  // **The analytics window is NOT the billing window.** Cloudflare's
  // GraphQL datasets hold roughly a month and reject a wider range, so
  // they are read trailing on every run regardless of which mode
  // billing is in — see `analyticsWindow`, which carries the measured
  // limit and why this cannot share the planner.
  const analyticsRange = analyticsWindow(today);
  const analytics = await fetchAnalyticsUsage(analyticsRange);
  if (analytics === null) {
    sourcesFailed.push("cloudflare_analytics");
  } else {
    rows.push(...parseAnalyticsUsage(analytics));
  }

  try {
    rows.push(...(await rollUpResendSends(window)));
  } catch (err) {
    sourcesFailed.push("resend");
    log.warn("cost.resend_rollup_failed", { error: errorMessage(err) });
  }

  // A backfill window that yielded no rows FROM THE BACKFILLED SOURCE
  // is the bottom of retention.
  //
  // Only billing backfills, so only billing rows answer the question.
  // Resend is excluded because its rollup emits an explicit zero for
  // every day in range, which would mean the floor is never detected;
  // analytics is excluded because it is read trailing and therefore
  // returns today's rows on every run, including the backfill run that
  // is trying to establish it has reached the end of billing history.
  const backfilledRows = rows.filter((r) => r.source === "cloudflare_billing");
  if (
    window.mode === "backfill" &&
    backfilledRows.length === 0 &&
    // A transient vendor outage must not be mistaken for the end of
    // history. Analytics can no longer appear here structurally, which
    // is what used to make this condition unsatisfiable forever.
    sourcesFailed.length === 0
  ) {
    await kv.put(BACKFILL_FLOOR_KEY, today);
    log.info("cost.backfill_complete", { floor: window.from });
  }

  const rowsWritten = await upsertSnapshots(rows);
  log.info("cost.snapshot_complete", {
    mode: window.mode,
    from: window.from,
    to: window.to,
    rowsWritten,
    sourcesFailed: sourcesFailed.join(",") || "none",
  });

  return {
    skipped: false,
    mode: window.mode,
    from: window.from,
    to: window.to,
    rowsWritten,
    sourcesFailed,
  };
}
