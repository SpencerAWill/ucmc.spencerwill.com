import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
import { getKv } from "#/server/kv";
import { runCostSnapshot } from "#/server/cron/cost-snapshot.server";
import * as client from "#/server/cost/cloudflare-client.server";
import { MAX_RANGE_DAYS } from "#/server/cost/snapshot-window";
import billableUsage from "#/server/cost/__tests__/fixtures/billable-usage.json";
import graphqlUsage from "#/server/cost/__tests__/fixtures/graphql-usage.json";

const NOW = Temporal.Instant.from("2026-10-09T16:00:00Z");
const FLOOR_KEY = "cost-snapshot:backfill-complete";

function configured() {
  vi.spyOn(client, "costCredentials").mockReturnValue({
    accountId: "acct",
    token: "tok",
  });
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  const db = getDb();
  await db.delete(schema.costSnapshots);
  await db.delete(schema.emailSends);
  await getKv().delete(FLOOR_KEY);
  vi.restoreAllMocks();
});

describe("runCostSnapshot", () => {
  it("skips without writing when credentials are unset", async () => {
    // Local dev and a fresh deploy both land here. It must be a quiet
    // skip, not a failure that reddens the whole daily tick.
    vi.spyOn(client, "costCredentials").mockReturnValue(null);

    const result = await runCostSnapshot(NOW);

    expect(result).toMatchObject({ skipped: true, skipReason: "unconfigured" });
    expect(await getDb().select().from(schema.costSnapshots)).toHaveLength(0);
  });

  it("writes rows from every source in one run", async () => {
    configured();
    // Establishes when the send log began; without it the Resend rollup
    // correctly declines to assert anything about those days.
    await getDb()
      .insert(schema.emailSends)
      .values({
        id: "snd_seed",
        kind: "auth.magic_link",
        sentAt: Temporal.Instant.from("2026-08-01T16:00:00Z"),
        ok: true,
      });
    vi.spyOn(client, "fetchBillableUsage").mockResolvedValue(billableUsage);
    vi.spyOn(client, "fetchAnalyticsUsage").mockResolvedValue(graphqlUsage);

    const result = await runCostSnapshot(NOW);

    expect(result.sourcesFailed).toEqual([]);
    const stored = await getDb().select().from(schema.costSnapshots);
    const sources = new Set(stored.map((r) => r.source));
    expect(sources).toEqual(
      new Set(["cloudflare_billing", "cloudflare_analytics", "resend"]),
    );
  });

  it("keeps the other sources when one fails", async () => {
    // Partial data beats none, and the failure is named in the result
    // rather than swallowed.
    configured();
    vi.spyOn(client, "fetchBillableUsage").mockResolvedValue(null);
    vi.spyOn(client, "fetchAnalyticsUsage").mockResolvedValue(graphqlUsage);

    const result = await runCostSnapshot(NOW);

    expect(result.sourcesFailed).toEqual(["cloudflare_billing"]);
    const stored = await getDb().select().from(schema.costSnapshots);
    expect(stored.some((r) => r.source === "cloudflare_analytics")).toBe(true);
    expect(stored.some((r) => r.source === "cloudflare_billing")).toBe(false);
  });

  it("writes no zero row for a source that failed", async () => {
    // The sharp edge the issue called out: a zero row later reads as a
    // true measurement of nothing, which is worse than a gap because
    // nothing distinguishes it from a real reading.
    configured();
    vi.spyOn(client, "fetchBillableUsage").mockResolvedValue(null);
    vi.spyOn(client, "fetchAnalyticsUsage").mockResolvedValue(null);

    await runCostSnapshot(NOW);

    const stored = await getDb().select().from(schema.costSnapshots);
    expect(stored.every((r) => r.source === "resend")).toBe(true);
  });

  it("starts in backfill mode on an empty table", async () => {
    configured();
    vi.spyOn(client, "fetchBillableUsage").mockResolvedValue(billableUsage);
    vi.spyOn(client, "fetchAnalyticsUsage").mockResolvedValue(graphqlUsage);

    const result = await runCostSnapshot(NOW);

    expect(result.mode).toBe("backfill");
    expect(result.to).toBe("2026-10-09");
  });

  it("records a floor when a backfill window yields no vendor rows", async () => {
    // Retention is shallower than the subscription, so backfill has to
    // stop on an empty window or it re-requests one forever.
    configured();
    vi.spyOn(client, "fetchBillableUsage").mockResolvedValue({ result: [] });
    vi.spyOn(client, "fetchAnalyticsUsage").mockResolvedValue({
      data: { viewer: { accounts: [{}] } },
    });

    await runCostSnapshot(NOW);

    expect(await getKv().get(FLOOR_KEY)).not.toBeNull();
  });

  it("does NOT record a floor when the emptiness was a failure", async () => {
    // An outage looks exactly like the bottom of retention from the
    // row count alone. Treating it as the floor would permanently
    // abandon history that is still there.
    configured();
    vi.spyOn(client, "fetchBillableUsage").mockResolvedValue(null);
    vi.spyOn(client, "fetchAnalyticsUsage").mockResolvedValue(null);

    await runCostSnapshot(NOW);

    expect(await getKv().get(FLOOR_KEY)).toBeNull();
  });

  it("switches to the trailing window once the floor is recorded", async () => {
    configured();
    await getKv().put(FLOOR_KEY, "2026-10-09");
    vi.spyOn(client, "fetchBillableUsage").mockResolvedValue({ result: [] });
    vi.spyOn(client, "fetchAnalyticsUsage").mockResolvedValue({
      data: { viewer: { accounts: [{}] } },
    });

    const result = await runCostSnapshot(NOW);

    expect(result.mode).toBe("trailing");
    expect(result.from).toBe("2026-10-06");
  });

  it("never asks analytics for the billing backfill window", async () => {
    // THE DEADLOCK, pinned.
    //
    // Analytics used to be handed the billing window, which is 90 days
    // in backfill mode. Cloudflare's GraphQL datasets reject anything
    // wider than 4w4d (measured: 31 days answers, 32 errors), so the
    // call failed on every backfill run. The failure landed in
    // `sourcesFailed`, and the backfill floor is only recorded when
    // that is empty — so the mode never flipped to trailing, the
    // window stayed 90 days, and Workers, D1 and KV produced no rows
    // EVER while R2 filled in normally. Exactly what dev showed.
    configured();
    const billing = vi
      .spyOn(client, "fetchBillableUsage")
      .mockResolvedValue(billableUsage);
    const analytics = vi
      .spyOn(client, "fetchAnalyticsUsage")
      .mockResolvedValue(graphqlUsage);

    // An empty table puts billing in backfill mode with a 90-day span.
    const result = await runCostSnapshot(NOW);
    expect(result.mode).toBe("backfill");

    const billingArgs = billing.mock.calls[0][0];
    const analyticsArgs = analytics.mock.calls[0][0];
    const span = (w: { from: string; to: string }) =>
      Temporal.PlainDate.from(w.from).until(Temporal.PlainDate.from(w.to)).days;

    // 89 days of difference is 90 days inclusive — the first backfill
    // window is `today - (MAX_RANGE_DAYS - 1) .. today`.
    expect(span(billingArgs)).toBe(MAX_RANGE_DAYS - 1);
    // The whole point: analytics stays inside what the API will serve
    // even while billing is reaching back three months.
    expect(span(analyticsArgs)).toBeLessThanOrEqual(31);
    expect(result.sourcesFailed).toEqual([]);
  });

  it("can still reach the backfill floor once analytics returns rows every run", async () => {
    // The second half of the deadlock. Analytics is now read trailing,
    // so it contributes rows on EVERY run including the backfill run
    // that is trying to establish billing has run dry. The floor test
    // therefore has to look at billing rows alone — counting any
    // vendor row would mean the floor is never detected again, which
    // is the same bug wearing different clothes.
    configured();
    vi.spyOn(client, "fetchBillableUsage").mockResolvedValue({ result: [] });
    vi.spyOn(client, "fetchAnalyticsUsage").mockResolvedValue(graphqlUsage);

    const result = await runCostSnapshot(NOW);

    expect(result.mode).toBe("backfill");
    expect(result.sourcesFailed).toEqual([]);
    // Analytics rows landed...
    expect(result.rowsWritten).toBeGreaterThan(0);
    // ...and the floor was still recorded, because billing had none.
    expect(await getKv().get(FLOOR_KEY)).not.toBeNull();
  });

  it("re-running the same window replaces rather than duplicates", async () => {
    // Trailing mode, because a BACKFILL run deliberately advances to an
    // older window on its next tick — that is the walk working, not a
    // duplicate.
    configured();
    await getKv().put(FLOOR_KEY, "2026-10-09");
    vi.spyOn(client, "fetchBillableUsage").mockResolvedValue(billableUsage);
    vi.spyOn(client, "fetchAnalyticsUsage").mockResolvedValue(graphqlUsage);

    await runCostSnapshot(NOW);
    const first = await getDb().select().from(schema.costSnapshots);
    await runCostSnapshot(NOW);
    const second = await getDb().select().from(schema.costSnapshots);

    expect(first.length).toBeGreaterThan(0);
    expect(second).toHaveLength(first.length);
  });

  it("advances to an older window on the next backfill tick", async () => {
    configured();
    vi.spyOn(client, "fetchBillableUsage").mockResolvedValue(billableUsage);
    vi.spyOn(client, "fetchAnalyticsUsage").mockResolvedValue(graphqlUsage);

    const first = await runCostSnapshot(NOW);
    const second = await runCostSnapshot(NOW);

    expect(first.mode).toBe("backfill");
    expect(second.mode).toBe("backfill");
    // Concrete dates rather than a relative comparison: `from` is
    // optional on the result (the unconfigured skip carries none), and
    // pinning the walk's actual step is more useful than "it moved".
    //
    // The second window steps back from the oldest DATA returned
    // (2026-09-13 in the fixture), not from the window that was
    // requested. That is the right anchor — the API answers with what
    // it has — and it means a sparse response simply gets re-requested
    // next tick, which the upsert makes harmless.
    expect(first.from).toBe("2026-07-12");
    expect(second.to).toBe("2026-09-13");
    expect(second.from).toBe("2026-06-15");
  });

  it("writes no Resend row for days before the send log existed", async () => {
    // A backfill reaches months further back than the log does. A zero
    // there would claim "we sent nothing" when the truth is "we were
    // not measuring" — the same trap as a zero row for a failed source.
    configured();
    vi.spyOn(client, "fetchBillableUsage").mockResolvedValue({ result: [] });
    vi.spyOn(client, "fetchAnalyticsUsage").mockResolvedValue({
      data: { viewer: { accounts: [{}] } },
    });
    await getDb()
      .insert(schema.emailSends)
      .values({
        id: "snd_first",
        kind: "auth.magic_link",
        sentAt: Temporal.Instant.from("2026-10-07T16:00:00Z"),
        ok: true,
      });
    await getKv().put(FLOOR_KEY, "2026-10-09");

    await runCostSnapshot(NOW);

    const resend = await getDb().select().from(schema.costSnapshots);
    const days = resend
      .filter((r) => r.source === "resend")
      .map((r) => r.periodStart)
      .sort();
    // Window is 2026-10-06..2026-10-09; logging began on the 7th.
    expect(days[0]).toBe("2026-10-07");
  });
});
