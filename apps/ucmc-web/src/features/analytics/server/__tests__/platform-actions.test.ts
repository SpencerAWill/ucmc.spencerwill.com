import { afterEach, describe, expect, it, vi } from "vitest";

import { currentSeason } from "#/config/club-season";
import {
  buildCost,
  buildHeadroom,
  platformAnalyticsAction,
} from "#/features/analytics/server/platform-actions.server";
import type * as SessionServer from "#/server/auth/session.server";
import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

const cookieJar = new Map<string, string>();
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => cookieJar.get(name),
  setCookie: (name: string, value: string) => {
    cookieJar.set(name, value);
  },
  deleteCookie: (name: string) => {
    cookieJar.delete(name);
  },
  getRequestHeader: () => undefined,
}));

vi.mock("#/server/auth/session.server", async () => {
  const actual = await vi.importActual<typeof SessionServer>(
    "#/server/auth/session.server",
  );
  return {
    ...actual,
    loadCurrentPrincipal: vi.fn(actual.loadCurrentPrincipal),
  };
});

afterEach(async () => {
  const db = getDb();
  await db.delete(schema.costSnapshots);
  await db.delete(schema.emailSends);
  await db.delete(schema.users);
});

async function asViewer(
  permissions: string[] = ["analytics:view", "settings:manage"],
): Promise<string> {
  const userId = `u_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({ id: userId, publicId: userId, status: "approved" });
  await attachPrimaryEmail(userId, `${userId}@example.com`);
  const { loadCurrentPrincipal } = await import("#/server/auth/session.server");
  vi.mocked(loadCurrentPrincipal).mockResolvedValue({
    userId,
    primaryEmail: `${userId}@example.com`,
    emails: [`${userId}@example.com`],
    preferredName: null,
    status: "approved",
    hasProfile: false,
    avatarKey: null,
    roles: [],
    isSystemAdmin: false,
    permissions,
    rolePermissionMap: {},
    roleDisplayNames: {},
  });
  return userId;
}

const snapshot = (over: Partial<typeof base> = {}) => ({ ...base, ...over });
const base = {
  source: "cloudflare_analytics" as const,
  serviceFamily: "KV" as string | null,
  serviceName: "kv.writes",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-02",
  quantity: 100,
  unit: "operations",
  costCents: null as number | null,
  currency: null as string | null,
  capturedAt: Temporal.Instant.from("2026-09-02T00:00:00Z"),
};

describe("buildHeadroom", () => {
  const rows = (
    entries: { serviceName: string; periodStart: string; quantity: number }[],
  ) =>
    entries.map((e) => ({
      serviceName: e.serviceName,
      serviceFamily: null,
      periodStart: e.periodStart,
      quantity: e.quantity,
      costCents: null,
    }));

  it("reports the peak period, not the latest or the mean", () => {
    // A daily cap is blown by one bad day. An average would hide
    // exactly the reading the panel exists to surface.
    const [kv] = buildHeadroom(
      rows([
        { serviceName: "kv.writes", periodStart: "2026-09-01", quantity: 10 },
        { serviceName: "kv.writes", periodStart: "2026-09-02", quantity: 900 },
        { serviceName: "kv.writes", periodStart: "2026-09-03", quantity: 20 },
      ]),
    );
    expect(kv.peak).toBe(900);
    expect(kv.peakDay).toBe("2026-09-02");
    expect(kv.fraction).toBeCloseTo(0.9);
  });

  it("ranks the tightest ceiling first, not the biggest number", () => {
    // 116 KV writes is a tighter squeeze than 338,711 D1 rows read,
    // because the ceilings differ by three orders of magnitude. Sorting
    // on raw quantity would invert this and point operators at the
    // wrong service.
    const ranked = buildHeadroom(
      rows([
        { serviceName: "kv.writes", periodStart: "2026-09-01", quantity: 116 },
        {
          serviceName: "d1.rows_read",
          periodStart: "2026-09-01",
          quantity: 338_711,
        },
      ]),
    );
    expect(ranked.map((s) => s.service)).toEqual(["kv.writes", "d1.rows_read"]);
  });

  it("sorts a service with no tracked limit last, not first", () => {
    // `fraction === null` must not sort as 0 at the head of a
    // worst-first list — "no known ceiling" is not "lots of headroom".
    const ranked = buildHeadroom(
      rows([
        {
          serviceName: "workers.cpu_time_us",
          periodStart: "2026-09-01",
          quantity: 9_999_999,
        },
        { serviceName: "kv.writes", periodStart: "2026-09-01", quantity: 1 },
      ]),
    );
    expect(ranked.at(-1)?.service).toBe("workers.cpu_time_us");
    expect(ranked.at(-1)?.fraction).toBeNull();
  });

  it("skips a service the vendor reports but we have not catalogued", () => {
    // Otherwise it renders beside real rows with an unknown ceiling,
    // reading as "no limit" rather than "we do not track this".
    expect(
      buildHeadroom(
        rows([
          {
            serviceName: "vendor.new_thing",
            periodStart: "2026-09-01",
            quantity: 5,
          },
        ]),
      ),
    ).toEqual([]);
  });

  it("gives a limitless service a row but no sparkline points", () => {
    const [cpu] = buildHeadroom(
      rows([
        {
          serviceName: "workers.cpu_time_us",
          periodStart: "2026-09-01",
          quantity: 42,
        },
      ]),
    );
    expect(cpu.peak).toBe(42);
    expect(cpu.daily).toEqual([]);
  });

  it("does not clamp a blown cap", () => {
    const [kv] = buildHeadroom(
      rows([
        { serviceName: "kv.writes", periodStart: "2026-09-01", quantity: 1400 },
      ]),
    );
    expect(kv.fraction).toBeCloseTo(1.4);
  });
});

describe("buildCost", () => {
  const costRow = (
    periodStart: string,
    serviceFamily: string | null,
    costCents: number | null,
  ) => ({
    serviceName: "r2.class_a_operations",
    serviceFamily,
    periodStart,
    quantity: 1,
    costCents,
  });

  it("folds daily rows into months per family", () => {
    const { costByMonth, totalCostCents } = buildCost([
      costRow("2026-09-01", "R2", 120),
      costRow("2026-09-14", "R2", 80),
      costRow("2026-10-02", "R2", 50),
    ]);
    expect(costByMonth).toEqual([
      { month: "2026-09", family: "R2", cents: 200 },
      { month: "2026-10", family: "R2", cents: 50 },
    ]);
    expect(totalCostCents).toBe(250);
  });

  it("drops zero and null rows so a month of zeros is not a bar", () => {
    // Every row is captured while the club is inside the free tier, so
    // without this the chart would be a wall of zero-height segments
    // claiming each service was billed.
    const { costByMonth, totalCostCents } = buildCost([
      costRow("2026-09-01", "R2", 0),
      costRow("2026-09-02", "R2", null),
    ]);
    expect(costByMonth).toEqual([]);
    expect(totalCostCents).toBe(0);
  });

  it("buckets a family-less source under Other", () => {
    const { costByMonth } = buildCost([costRow("2026-09-01", null, 10)]);
    expect(costByMonth[0].family).toBe("Other");
  });
});

describe("platformAnalyticsAction", () => {
  it("refuses a viewer without settings:manage", async () => {
    // analytics:view opens the AREA; it must not by itself hand over
    // operational data. This is the whole two-permission model.
    await asViewer(["analytics:view"]);
    await expect(platformAnalyticsAction({})).rejects.toThrow(
      /settings:manage/,
    );
  });

  it("refuses a viewer without analytics:view", async () => {
    await asViewer(["settings:manage"]);
    await expect(platformAnalyticsAction({})).rejects.toThrow(/analytics:view/);
  });

  it("defaults to the current season", async () => {
    await asViewer();
    const result = await platformAnalyticsAction({});
    expect(result.season).toBe(currentSeason());
  });

  it("bounds the window to the requested season, Aug 1 to Aug 1", async () => {
    await asViewer();
    const result = await platformAnalyticsAction({ season: "2026-27" });
    expect(result.windowStart).toBe("2026-08-01");
    expect(result.windowEnd).toBe("2027-08-01");
  });

  it("excludes snapshots from a neighbouring season", async () => {
    await asViewer();
    await getDb()
      .insert(schema.costSnapshots)
      .values([
        // Jul 31 belongs to the PREVIOUS season; Aug 1 opens this one.
        snapshot({ periodStart: "2026-07-31", quantity: 999 }),
        snapshot({ periodStart: "2026-08-01", quantity: 116 }),
      ]);

    const result = await platformAnalyticsAction({ season: "2026-27" });
    const kv = result.headroom.find((s) => s.service === "kv.writes");
    expect(kv?.peak).toBe(116);
  });

  it("distinguishes no snapshots from no cost", async () => {
    await asViewer();
    const empty = await platformAnalyticsAction({ season: "2026-27" });
    expect(empty.noSnapshots).toBe(true);
    expect(empty.totalCostCents).toBe(0);

    await getDb()
      .insert(schema.costSnapshots)
      .values([snapshot({ periodStart: "2026-08-02", costCents: 0 })]);
    const free = await platformAnalyticsAction({ season: "2026-27" });
    expect(free.noSnapshots).toBe(false);
    expect(free.totalCostCents).toBe(0);
  });

  it("counts rejected sends separately from delivered ones", async () => {
    await asViewer();
    await getDb()
      .insert(schema.emailSends)
      .values([
        {
          id: "e1",
          kind: "gear_due_soon",
          ok: true,
          sentAt: Temporal.Instant.from("2026-09-10T12:00:00Z"),
        },
        {
          id: "e2",
          kind: "gear_due_soon",
          ok: false,
          sentAt: Temporal.Instant.from("2026-09-10T12:01:00Z"),
        },
      ]);

    const result = await platformAnalyticsAction({ season: "2026-27" });
    expect(result.emails).toEqual([
      { kind: "gear_due_soon", sent: 1, failed: 1 },
    ]);
  });
});
