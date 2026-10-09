/**
 * Every service we snapshot, and what its free tier allows.
 *
 * A registry rather than magic numbers in a query, for the same reason
 * `notification-registry.ts` and the settings registry are registries:
 * the panel, the reports and any alert must all agree on what "80% of
 * the free tier" means, and a limit written twice is a limit that
 * disagrees with itself the first time Cloudflare changes one.
 *
 * ## Why limits have to live here at all
 *
 * They are not discoverable. Cloudflare's Billable Usage API embeds an
 * allowance in its display string ("R2 Data Storage (First 10GB-Month
 * included)") but only for services with a paid subscription — Workers,
 * D1 and KV on the free plan produce no billing rows whatsoever, so
 * their usage comes from the GraphQL analytics datasets, which report
 * consumption and say nothing about entitlement. Resend publishes
 * quota headers but no history.
 *
 * **So these numbers are hand-entered and will go stale.** They are
 * the one part of this feature that cannot be verified against an API,
 * which is why each carries its source. Check them when a bill or a
 * plan changes.
 *
 * ## Periods are not uniform, and that is the point
 *
 * Workers, D1 and KV meter per DAY; R2 meters per MONTH. A panel that
 * assumed one period would be wrong about whichever services use the
 * other, and the daily ones are where this club actually sits closest
 * to a ceiling.
 *
 * Pure data, no DB import.
 */

/** Which vendor API a series comes from. */
export type CostSource =
  "cloudflare_billing" | "cloudflare_analytics" | "resend";

export interface ServiceMeta {
  /** How it reads on a report. */
  label: string;
  source: CostSource;
  /** Groups a stacked bar; `null` where the vendor has no family. */
  family: "Workers" | "D1" | "KV" | "R2" | null;
  /** What `quantity` counts. */
  unit: string;
  /**
   * Free-tier allowance, or `null` where the service has no published
   * free limit worth tracking.
   */
  freeLimit: number | null;
  /** The window `freeLimit` applies to. */
  limitPeriod: "day" | "month";
  /** Where the number came from, so it can be rechecked. */
  limitSource: string;
}

export const COST_SERVICES = {
  "workers.requests": {
    label: "Worker requests",
    source: "cloudflare_analytics",
    family: "Workers",
    unit: "requests",
    freeLimit: 100_000,
    limitPeriod: "day",
    limitSource: "Workers Free plan — 100,000 requests/day",
  },
  "workers.cpu_time_us": {
    label: "Worker CPU time",
    source: "cloudflare_analytics",
    family: "Workers",
    unit: "microseconds",
    // Metered per invocation, not per day, so a daily total has no cap
    // to divide by. Captured because it is the input to the limit that
    // actually bites — see issue #272, where `exceededResources` is
    // terminating a few percent of production requests.
    freeLimit: null,
    limitPeriod: "day",
    limitSource: "per-invocation limit; no daily aggregate cap",
  },
  "d1.rows_read": {
    label: "D1 rows read",
    source: "cloudflare_analytics",
    family: "D1",
    unit: "rows",
    // ROWS, not queries. D1's free tier limits rows, and the analytics
    // dataset reports both — metering the query count would measure
    // the wrong thing and read far under the real headroom.
    freeLimit: 5_000_000,
    limitPeriod: "day",
    limitSource: "D1 Free — 5 million rows read/day",
  },
  "d1.rows_written": {
    label: "D1 rows written",
    source: "cloudflare_analytics",
    family: "D1",
    unit: "rows",
    freeLimit: 100_000,
    limitPeriod: "day",
    limitSource: "D1 Free — 100,000 rows written/day",
  },
  "kv.reads": {
    label: "KV reads",
    source: "cloudflare_analytics",
    family: "KV",
    unit: "operations",
    freeLimit: 100_000,
    limitPeriod: "day",
    limitSource: "Workers KV Free — 100,000 reads/day",
  },
  "kv.writes": {
    label: "KV writes",
    source: "cloudflare_analytics",
    family: "KV",
    unit: "operations",
    // The tightest constraint on this account by a factor of two:
    // measured peak was 116/day against this 1,000 ceiling, while
    // every other service sat under 7% of its own. Worth knowing
    // before anything starts writing to KV per request.
    freeLimit: 1_000,
    limitPeriod: "day",
    limitSource: "Workers KV Free — 1,000 writes/day",
  },
  "kv.deletes": {
    label: "KV deletes",
    source: "cloudflare_analytics",
    family: "KV",
    unit: "operations",
    freeLimit: 1_000,
    limitPeriod: "day",
    limitSource: "Workers KV Free — 1,000 deletes/day",
  },
  "kv.lists": {
    label: "KV lists",
    source: "cloudflare_analytics",
    family: "KV",
    unit: "operations",
    freeLimit: 1_000,
    limitPeriod: "day",
    limitSource: "Workers KV Free — 1,000 lists/day",
  },
  "r2.storage_gb_month": {
    label: "R2 stored data",
    source: "cloudflare_billing",
    family: "R2",
    unit: "GB-months",
    freeLimit: 10,
    limitPeriod: "month",
    limitSource: "R2 Free — 10 GB-month, per billable-usage service name",
  },
  "r2.class_a_operations": {
    label: "R2 class A operations",
    source: "cloudflare_billing",
    family: "R2",
    unit: "operations",
    freeLimit: 1_000_000,
    limitPeriod: "month",
    limitSource: "R2 Free — 1M class A ops/month",
  },
  "r2.class_b_operations": {
    label: "R2 class B operations",
    source: "cloudflare_billing",
    family: "R2",
    unit: "operations",
    freeLimit: 10_000_000,
    limitPeriod: "month",
    limitSource: "R2 Free — 10M class B ops/month",
  },
  "resend.sends": {
    label: "Emails sent",
    source: "resend",
    family: null,
    unit: "emails",
    freeLimit: 100,
    limitPeriod: "day",
    limitSource: "Resend Free — 100 emails/day, 3,000/month",
  },
} as const satisfies Record<string, ServiceMeta>;

export type CostServiceName = keyof typeof COST_SERVICES;

/**
 * Fraction of the free allowance a quantity represents, or `null` when
 * the service has no tracked limit.
 *
 * Deliberately NOT clamped to 1: a panel showing 140% is telling the
 * truth about a day the cap was blown, and clamping would hide the one
 * reading anybody needs to see.
 */
export function headroomFraction(
  service: CostServiceName,
  quantity: number,
): number | null {
  const { freeLimit } = COST_SERVICES[service];
  return freeLimit === null ? null : quantity / freeLimit;
}
