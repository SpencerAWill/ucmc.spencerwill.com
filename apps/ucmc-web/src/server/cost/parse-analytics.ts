/**
 * Parses the Cloudflare GraphQL Analytics datasets into snapshot rows.
 *
 * **This is where free-tier usage lives.** The Billable Usage API only
 * reports services with a paid subscription — on a free-plan account
 * that is R2 and nothing else — so Workers, D1 and KV usage, which is
 * precisely the usage with daily caps worth watching, is reachable
 * only here.
 *
 * Each dataset needs its own token scope: Workers Scripts Read, D1
 * Read, Workers KV Storage Read. Account Analytics Read does NOT cover
 * them, despite the documentation implying otherwise — each returns
 * `authorization denied` until its own product scope is granted.
 *
 * Rows are summed to ACCOUNT TOTALS, deliberately discarding the
 * `scriptName` and `databaseId` dimensions the API offers. The free-tier
 * limits these are measured against are account-scoped, so a per-script
 * row would widen the key without making headroom any more answerable.
 * The dimensions are still requested, because summing them here is free
 * and re-querying history later is not.
 *
 * Shapes pinned by `fixtures/graphql-usage.json`, captured live.
 */
import type { SnapshotRow } from "#/server/cost/snapshot-row";

interface Group {
  dimensions?: { date?: unknown; actionType?: unknown } | null;
  sum?: Record<string, unknown> | null;
}

/** KV meters each operation type against its own daily cap. */
// `| undefined` is load-bearing: `noUncheckedIndexedAccess` is off in
// this project, so a plain `Record<string, string>` would type an
// unknown action as a definite hit and the guard below as dead code.
const KV_SERVICE_BY_ACTION: Record<string, string | undefined> = {
  read: "kv.reads",
  write: "kv.writes",
  delete: "kv.deletes",
  list: "kv.lists",
};

function groupsOf(payload: unknown, key: string): Group[] {
  const accounts = (
    payload as {
      data?: { viewer?: { accounts?: unknown } | null } | null;
    } | null
  )?.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return [];
  }
  const groups = (accounts[0] as Record<string, unknown>)[key];
  return Array.isArray(groups) ? (groups as Group[]) : [];
}

function dateOf(group: Group): string | null {
  const d = group.dimensions?.date;
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function metric(group: Group, name: string): number {
  const v = group.sum?.[name];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** `"2026-09-13"` plus one day, as a civil date. */
export function nextDay(date: string): string {
  return Temporal.PlainDate.from(date).add({ days: 1 }).toString();
}

function accumulate(
  into: Map<string, SnapshotRow>,
  serviceName: string,
  family: string,
  unit: string,
  date: string,
  quantity: number,
): void {
  const key = `${serviceName}::${date}`;
  const existing = into.get(key);
  if (existing !== undefined) {
    existing.quantity += quantity;
    return;
  }
  into.set(key, {
    source: "cloudflare_analytics",
    serviceFamily: family,
    serviceName,
    periodStart: date,
    periodEnd: nextDay(date),
    quantity,
    unit,
    // Analytics reports consumption and says nothing about money.
    // Null rather than 0: "we did not measure cost here" and "this cost
    // nothing" are different claims, and a report must not add the
    // first into a total as though it were the second.
    costCents: null,
    currency: null,
  });
}

export function parseAnalyticsUsage(payload: unknown): SnapshotRow[] {
  const rows = new Map<string, SnapshotRow>();

  for (const g of groupsOf(payload, "workersInvocationsAdaptive")) {
    const date = dateOf(g);
    if (date === null) {
      continue;
    }
    // Summed across every script on the account, which is the whole
    // account's usage against an account-scoped cap.
    accumulate(
      rows,
      "workers.requests",
      "Workers",
      "requests",
      date,
      metric(g, "requests"),
    );
    accumulate(
      rows,
      "workers.cpu_time_us",
      "Workers",
      "microseconds",
      date,
      metric(g, "cpuTimeUs"),
    );
  }

  for (const g of groupsOf(payload, "d1AnalyticsAdaptiveGroups")) {
    const date = dateOf(g);
    if (date === null) {
      continue;
    }
    // ROWS, not queries: D1's free tier limits rows, and the two differ
    // by an order of magnitude on real traffic.
    accumulate(rows, "d1.rows_read", "D1", "rows", date, metric(g, "rowsRead"));
    accumulate(
      rows,
      "d1.rows_written",
      "D1",
      "rows",
      date,
      metric(g, "rowsWritten"),
    );
  }

  for (const g of groupsOf(payload, "kvOperationsAdaptiveGroups")) {
    const date = dateOf(g);
    const action = g.dimensions?.actionType;
    if (date === null || typeof action !== "string") {
      continue;
    }
    const serviceName = KV_SERVICE_BY_ACTION[action];
    if (serviceName === undefined) {
      // An operation type we have no catalogue entry for. Skipped
      // rather than folded into another bucket: KV caps each type
      // separately, so attributing a write to reads would understate
      // the one metric sitting closest to its ceiling.
      continue;
    }
    accumulate(
      rows,
      serviceName,
      "KV",
      "operations",
      date,
      metric(g, "requests"),
    );
  }

  return [...rows.values()];
}
