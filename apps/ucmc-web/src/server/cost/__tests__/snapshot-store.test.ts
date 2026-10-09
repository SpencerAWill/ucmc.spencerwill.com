import { afterEach, describe, expect, it } from "vitest";

import type { SnapshotRow } from "#/server/cost/snapshot-row";
import {
  earliestSnapshotDate,
  upsertSnapshots,
} from "#/server/cost/snapshot-store.server";
import { rollUpResendSends } from "#/server/cost/resend-rollup.server";
import { getDb, schema } from "#/server/db";

const row = (over: Partial<SnapshotRow> = {}): SnapshotRow => ({
  source: "cloudflare_analytics",
  serviceFamily: "Workers",
  serviceName: "workers.requests",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-02",
  quantity: 100,
  unit: "requests",
  costCents: null,
  currency: null,
  ...over,
});

afterEach(async () => {
  const db = getDb();
  await db.delete(schema.costSnapshots);
  await db.delete(schema.emailSends);
});

describe("upsertSnapshots", () => {
  it("replaces a day's figure rather than rejecting the second write", async () => {
    // The trailing re-read exists precisely so a late vendor correction
    // lands. An insert-only path would make the first reading permanent.
    await upsertSnapshots([row({ quantity: 100 })]);
    await upsertSnapshots([row({ quantity: 175 })]);

    const stored = await getDb().select().from(schema.costSnapshots);
    expect(stored).toHaveLength(1);
    expect(stored[0].quantity).toBe(175);
  });

  it("keeps the same service on different days apart", async () => {
    await upsertSnapshots([
      row({ periodStart: "2026-10-01" }),
      row({ periodStart: "2026-10-02" }),
    ]);
    expect(await getDb().select().from(schema.costSnapshots)).toHaveLength(2);
  });

  it("keeps the same day from different sources apart", async () => {
    // Billing and analytics both report R2-ish things; the source is
    // part of the key so one cannot clobber the other.
    await upsertSnapshots([
      row({ source: "cloudflare_analytics" }),
      row({ source: "cloudflare_billing" }),
    ]);
    expect(await getDb().select().from(schema.costSnapshots)).toHaveLength(2);
  });

  it("chunks past D1's parameter cap", async () => {
    // Nine columns per row against a 100-parameter statement limit — a
    // backfill window is ~90 days times a dozen services, so this path
    // is the normal one, not an edge case.
    const many = Array.from({ length: 95 }, (_, i) =>
      row({
        periodStart: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
        serviceName: `svc.${i}`,
      }),
    );
    await expect(upsertSnapshots(many)).resolves.toBe(95);
    expect(await getDb().select().from(schema.costSnapshots)).toHaveLength(95);
  });

  it("writes nothing and reports zero for an empty batch", async () => {
    expect(await upsertSnapshots([])).toBe(0);
  });
});

describe("earliestSnapshotDate", () => {
  it("answers null on an empty table, which starts a backfill", async () => {
    expect(await earliestSnapshotDate()).toBeNull();
  });

  it("answers the oldest day held", async () => {
    await upsertSnapshots([
      row({ periodStart: "2026-09-20" }),
      row({ periodStart: "2026-07-14" }),
      row({ periodStart: "2026-10-01" }),
    ]);
    expect(await earliestSnapshotDate()).toBe("2026-07-14");
  });
});

describe("rollUpResendSends", () => {
  async function seedSend(at: string) {
    await getDb()
      .insert(schema.emailSends)
      .values({
        id: `snd_${Math.random().toString(36).slice(2)}`,
        kind: "auth.magic_link",
        sentAt: Temporal.Instant.from(at),
        ok: true,
      });
  }

  it("counts sends into club-local days, not UTC days", async () => {
    // 2026-10-05T01:00Z is 2026-10-04 21:00 in Cincinnati. A UTC bucket
    // puts the club's evening reminder mail on the wrong day — and
    // evening mail is most of what this counts.
    await seedSend("2026-10-05T01:00:00Z");

    const rows = await rollUpResendSends({
      from: "2026-10-04",
      to: "2026-10-05",
    });
    const byDay = Object.fromEntries(
      rows.map((r) => [r.periodStart, r.quantity]),
    );
    expect(byDay["2026-10-04"]).toBe(1);
    expect(byDay["2026-10-05"]).toBe(0);
  });

  it("emits an explicit zero for a quiet day once logging has begun", async () => {
    // A missing row and a zero mean different things — "not measuring"
    // vs "we sent nothing" — and a chart that skips a quiet day draws a
    // continuous line across a gap it should show.
    await seedSend("2026-10-01T16:00:00Z");

    const rows = await rollUpResendSends({
      from: "2026-10-01",
      to: "2026-10-03",
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.quantity)).toEqual([1, 0, 0]);
  });

  it("emits nothing for days before the log existed", async () => {
    // A backfill reaches months further back than the send log does.
    // Zeros there would claim a measurement that was never taken.
    await seedSend("2026-10-03T16:00:00Z");

    const rows = await rollUpResendSends({
      from: "2026-10-01",
      to: "2026-10-03",
    });

    expect(rows.map((r) => r.periodStart)).toEqual(["2026-10-03"]);
  });

  it("emits nothing at all when no send has ever been logged", async () => {
    expect(
      await rollUpResendSends({ from: "2026-10-01", to: "2026-10-03" }),
    ).toEqual([]);
  });

  it("counts failed sends too", async () => {
    await getDb()
      .insert(schema.emailSends)
      .values({
        id: "snd_failed",
        kind: "gear.loan_overdue",
        sentAt: Temporal.Instant.from("2026-10-02T16:00:00Z"),
        ok: false,
      });
    const [day] = await rollUpResendSends({
      from: "2026-10-02",
      to: "2026-10-02",
    });
    expect(day.quantity).toBe(1);
  });

  it("ignores sends outside the window", async () => {
    await seedSend("2026-09-30T16:00:00Z");
    const [day] = await rollUpResendSends({
      from: "2026-10-01",
      to: "2026-10-01",
    });
    expect(day.quantity).toBe(0);
  });
});
