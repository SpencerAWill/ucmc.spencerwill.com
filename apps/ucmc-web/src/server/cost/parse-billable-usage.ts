/**
 * Parses Cloudflare's Billable Usage API into snapshot rows.
 *
 * **The endpoint is Alpha** ("Version 1, Alpha" in the docs), so the
 * response shape can move under us. Everything here is defensive and
 * every claim is pinned by `fixtures/billable-usage.json`, captured
 * from the live API rather than transcribed from documentation — which
 * matters, because the documentation was wrong about three things:
 *
 * 1. Rows arrive inside the standard v4 envelope (`{ result, success,
 *    errors, messages }`), not bare.
 * 2. `PricingQuantity` is the quantity remaining AFTER the free
 *    allowance, so it is 0 for every row while the account is inside
 *    the free tier. `ConsumedQuantity` is real usage.
 * 3. `ConsumedUnit` is an empty string on count-based services;
 *    `PricingUnit` carries the real unit.
 *
 * Two further behaviours, established by probing rather than documented:
 * the maximum query range is **90 days**, and a request whose range
 * does not include the subscription's billing-cycle anchor day returns
 * nothing at all.
 */
import type { SnapshotRow } from "#/server/cost/snapshot-row";

interface BillableUsageRow {
  ServiceName?: unknown;
  ServiceFamilyName?: unknown;
  ChargePeriodStart?: unknown;
  ChargePeriodEnd?: unknown;
  ConsumedQuantity?: unknown;
  ConsumedUnit?: unknown;
  PricingUnit?: unknown;
  ContractedCost?: unknown;
  BillingCurrency?: unknown;
}

/**
 * Vendor display name (allowance stripped) to our stable key.
 *
 * Matching happens on the name with its parenthetical removed, because
 * Cloudflare embeds the free allowance in the string — "R2 Data Storage
 * (First 10GB-Month included)" — and that text changes when the
 * allowance does. Keying on the raw string would strand every
 * historical row under an old key the day Cloudflare edits it.
 */
// `| undefined` for the same reason as `KV_SERVICE_BY_ACTION`: without
// it the `??` fallback below types as unreachable.
const SERVICE_KEYS: Record<string, string | undefined> = {
  "R2 Data Storage": "r2.storage_gb_month",
  "R2 Storage Class A Operations": "r2.class_a_operations",
  "R2 Storage Class B Operations": "r2.class_b_operations",
};

/** Strips a trailing "(First 10GB-Month included)" and surrounding space. */
export function normalizeServiceName(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * Turns a vendor name we have no key for into a stable, greppable one.
 *
 * Unmapped services are KEPT rather than dropped. Dropping one would
 * understate a cost total silently, and a cost report that quietly
 * omits a line item is worse than one showing an unfamiliar label.
 */
function fallbackKey(family: string, normalized: string): string {
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${family.toLowerCase()}.${slug}`;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** `"2026-09-13T00:00:00Z"` becomes `"2026-09-13"`. */
function civilDate(value: unknown): string | null {
  const s = asString(value);
  return s !== null && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * Rows the payload yields. Anything unparseable is skipped rather than
 * thrown on: one malformed row from an Alpha endpoint must not cost us
 * the rest of the day's snapshot.
 */
export function parseBillableUsage(payload: unknown): SnapshotRow[] {
  const result = (payload as { result?: unknown } | null)?.result;
  if (!Array.isArray(result)) {
    return [];
  }

  const rows: SnapshotRow[] = [];
  for (const raw of result as BillableUsageRow[]) {
    const name = asString(raw.ServiceName);
    const family = asString(raw.ServiceFamilyName);
    const start = civilDate(raw.ChargePeriodStart);
    const end = civilDate(raw.ChargePeriodEnd);
    const quantity = asNumber(raw.ConsumedQuantity);
    if (name === null || start === null || end === null || quantity === null) {
      continue;
    }

    const normalized = normalizeServiceName(name);
    const serviceName =
      SERVICE_KEYS[normalized] ??
      fallbackKey(family ?? "cloudflare", normalized);

    // `ConsumedUnit` is empty on count-based services; `PricingUnit`
    // carries "Count" there. Preferring the populated one keeps the
    // unit column meaningful across both kinds.
    const unit =
      asString(raw.ConsumedUnit) ?? asString(raw.PricingUnit) ?? "units";

    const cost = asNumber(raw.ContractedCost);
    rows.push({
      source: "cloudflare_billing",
      serviceFamily: family,
      serviceName,
      periodStart: start,
      periodEnd: end,
      quantity,
      unit,
      // Money in cents, so a report never adds floats. Rounded rather
      // than truncated: sub-cent daily charges are normal at this scale
      // and truncation would floor a month of them to zero.
      costCents: cost === null ? null : Math.round(cost * 100),
      currency: asString(raw.BillingCurrency),
    });
  }
  return rows;
}

/**
 * Collapses rows sharing a (service, day) into one.
 *
 * The API reports per subscription, so one service can appear more than
 * once for a day; the snapshot's primary key is
 * (source, service, period_start) and would otherwise reject the second.
 */
export function mergeByServiceDay(rows: SnapshotRow[]): SnapshotRow[] {
  const merged = new Map<string, SnapshotRow>();
  for (const row of rows) {
    const key = `${row.serviceName}::${row.periodStart}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, { ...row });
      continue;
    }
    existing.quantity += row.quantity;
    if (row.costCents !== null) {
      existing.costCents = (existing.costCents ?? 0) + row.costCents;
    }
  }
  return [...merged.values()];
}
