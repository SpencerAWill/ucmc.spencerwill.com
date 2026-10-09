import { describe, expect, it } from "vitest";

import {
  mergeByServiceDay,
  normalizeServiceName,
  parseBillableUsage,
} from "#/server/cost/parse-billable-usage";
import { parseAnalyticsUsage } from "#/server/cost/parse-analytics";
import billableUsage from "./fixtures/billable-usage.json";
import graphqlUsage from "./fixtures/graphql-usage.json";

// Both fixtures were captured from the LIVE APIs, redacted, and
// committed. That is the point of them: the Billable Usage endpoint is
// Alpha and the documentation was wrong about three separate things, so
// a hand-authored fixture would have pinned the docs rather than
// reality. If an endpoint moves, these fail.

describe("parseBillableUsage", () => {
  const rows = parseBillableUsage(billableUsage);

  it("reads rows out of the v4 envelope, not a bare array", () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(parseBillableUsage({ result: null })).toEqual([]);
    expect(parseBillableUsage(null)).toEqual([]);
  });

  it("records ConsumedQuantity, not the post-allowance PricingQuantity", () => {
    // The whole feature turns on this. `PricingQuantity` is what remains
    // after the free allowance and is 0 on every fixture row; recording
    // it would snapshot zeros forever and make headroom unanswerable.
    const raw = billableUsage.result;
    expect(raw.every((r) => r.PricingQuantity === 0)).toBe(true);
    expect(raw.some((r) => r.ConsumedQuantity > 0)).toBe(true);
    expect(rows.some((r) => r.quantity > 0)).toBe(true);
  });

  it("keys on the service name with its allowance stripped", () => {
    // Cloudflare writes the allowance into the display string, and it
    // changes when the allowance does.
    expect(
      normalizeServiceName("R2 Data Storage (First 10GB-Month included)"),
    ).toBe("R2 Data Storage");
    expect(rows.map((r) => r.serviceName)).toContain("r2.storage_gb_month");
    expect(rows.every((r) => !r.serviceName.includes("("))).toBe(true);
  });

  it("falls back to a derived key rather than dropping an unknown service", () => {
    // Dropping would understate a cost total silently. A report that
    // quietly omits a line item is worse than one with an odd label.
    const [parsed] = parseBillableUsage({
      result: [
        {
          ServiceName: "Workers Paid Invocations (First 10M included)",
          ServiceFamilyName: "Workers",
          ChargePeriodStart: "2026-09-13T00:00:00Z",
          ChargePeriodEnd: "2026-09-14T00:00:00Z",
          ConsumedQuantity: 5,
          ConsumedUnit: "",
          PricingUnit: "Count",
          ContractedCost: 0,
          BillingCurrency: "USD",
        },
      ],
    });
    expect(parsed.serviceName).toBe("workers.workers_paid_invocations");
  });

  it("takes the unit from PricingUnit when ConsumedUnit is empty", () => {
    const counted = rows.find((r) => r.serviceName === "r2.class_b_operations");
    expect(counted?.unit).toBe("Count");
    const stored = rows.find((r) => r.serviceName === "r2.storage_gb_month");
    expect(stored?.unit).toBe("GB-months");
  });

  it("stores money in cents, rounded rather than truncated", () => {
    const [parsed] = parseBillableUsage({
      result: [
        {
          ServiceName: "R2 Data Storage",
          ServiceFamilyName: "R2",
          ChargePeriodStart: "2026-09-13T00:00:00Z",
          ChargePeriodEnd: "2026-09-14T00:00:00Z",
          ConsumedQuantity: 1,
          PricingUnit: "GB-months",
          // Sub-cent daily charges are normal at this scale; truncating
          // would floor a whole month of them to zero.
          ContractedCost: 0.006,
          BillingCurrency: "USD",
        },
      ],
    });
    expect(parsed.costCents).toBe(1);
  });

  it("skips a malformed row instead of losing the whole day", () => {
    const parsed = parseBillableUsage({
      result: [
        { ServiceName: "R2 Data Storage" }, // no period, no quantity
        {
          ServiceName: "R2 Data Storage",
          ServiceFamilyName: "R2",
          ChargePeriodStart: "2026-09-13T00:00:00Z",
          ChargePeriodEnd: "2026-09-14T00:00:00Z",
          ConsumedQuantity: 2,
          PricingUnit: "GB-months",
        },
      ],
    });
    expect(parsed).toHaveLength(1);
  });

  it("emits daily charge periods as half-open civil dates", () => {
    for (const row of rows) {
      expect(row.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.periodEnd > row.periodStart).toBe(true);
    }
  });
});

describe("mergeByServiceDay", () => {
  it("collapses a repeated (service, day) so the primary key holds", () => {
    // The API reports per subscription, so one service can appear more
    // than once for a day; (source, service, period_start) is the PK.
    const merged = mergeByServiceDay([
      ...parseBillableUsage(billableUsage),
      ...parseBillableUsage(billableUsage),
    ]);
    const keys = merged.map((r) => `${r.serviceName}::${r.periodStart}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("sums the duplicates rather than discarding one", () => {
    const once = parseBillableUsage(billableUsage);
    const twice = mergeByServiceDay([...once, ...once]);
    const total = (rows: { quantity: number }[]) =>
      rows.reduce((n, r) => n + r.quantity, 0);
    expect(total(twice)).toBeCloseTo(total(once) * 2);
  });
});

describe("parseAnalyticsUsage", () => {
  const rows = parseAnalyticsUsage(graphqlUsage);
  const byName = (name: string) => rows.filter((r) => r.serviceName === name);

  it("covers the three families billing cannot see at all", () => {
    // The reason this parser exists: on a free plan the Billable Usage
    // API returns R2 and nothing else.
    expect(new Set(rows.map((r) => r.serviceFamily))).toEqual(
      new Set(["Workers", "D1", "KV"]),
    );
  });

  it("sums across scripts into one account total per day", () => {
    const groups =
      graphqlUsage.data.viewer.accounts[0].workersInvocationsAdaptive;
    const scripts = new Set(groups.map((g) => g.dimensions.scriptName));
    expect(
      scripts.size,
      "fixture must span >1 script to prove summing",
    ).toBeGreaterThan(1);

    for (const row of byName("workers.requests")) {
      const expected = groups
        .filter((g) => g.dimensions.date === row.periodStart)
        .reduce((n, g) => n + g.sum.requests, 0);
      expect(row.quantity).toBe(expected);
    }
    // One row per day, not one per script.
    const dates = byName("workers.requests").map((r) => r.periodStart);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("meters D1 in rows, not queries", () => {
    expect(byName("d1.rows_read").length).toBeGreaterThan(0);
    expect(byName("d1.rows_read")[0].unit).toBe("rows");
    expect(byName("d1.readQueries")).toHaveLength(0);
  });

  it("splits KV by action type, because each has its own cap", () => {
    // Folding a write into reads would understate the metric sitting
    // closest to its ceiling — KV writes allow 1,000/day against
    // 100,000 reads.
    const names = new Set(rows.map((r) => r.serviceName));
    expect(names.has("kv.writes")).toBe(true);
    expect(names.has("kv.reads")).toBe(true);
  });

  it("leaves cost null rather than zero", () => {
    // "We did not measure cost here" and "this cost nothing" are
    // different claims; a report must not total the first as the second.
    expect(rows.every((r) => r.costCents === null)).toBe(true);
  });

  it("returns nothing for an errored or empty payload", () => {
    expect(
      parseAnalyticsUsage({ errors: [{ message: "authorization denied" }] }),
    ).toEqual([]);
    expect(parseAnalyticsUsage(null)).toEqual([]);
    expect(parseAnalyticsUsage({ data: { viewer: { accounts: [] } } })).toEqual(
      [],
    );
  });

  it("emits half-open daily periods", () => {
    for (const row of rows) {
      expect(row.periodEnd).toBe(
        Temporal.PlainDate.from(row.periodStart).add({ days: 1 }).toString(),
      );
    }
  });
});
