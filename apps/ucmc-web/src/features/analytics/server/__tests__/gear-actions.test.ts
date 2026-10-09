import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bandOverdue,
  gearAnalyticsAction,
  medianLoanDays,
} from "#/features/analytics/server/gear-actions.server";
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

const SEASON = "2026-27";
const NOW = Temporal.Instant.from("2026-10-09T12:00:00Z");
const at = (iso: string) => Temporal.Instant.from(iso);

afterEach(async () => {
  const db = getDb();
  await db.delete(schema.gearLoans);
  await db.delete(schema.gearInspections);
  await db.delete(schema.gearItems);
  await db.delete(schema.gearModels);
  await db.delete(schema.gearTypes);
  await db.delete(schema.users);
});

async function asViewer(
  permissions: string[] = ["analytics:view", "gear:read"],
) {
  const userId = `officer_${crypto.randomUUID()}`;
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

describe("bandOverdue", () => {
  const open = (dueAt: string) => ({ dueAt: at(dueAt) });

  it("does not count a loan due today as overdue", () => {
    // Due-at is an end-of-day instant; a member still has the day.
    expect(bandOverdue([open("2026-10-09T23:59:00Z")], NOW).overdueNow).toBe(0);
  });

  it("does not count a loan due in the future", () => {
    expect(bandOverdue([open("2026-10-20T12:00:00Z")], NOW).overdueNow).toBe(0);
  });

  it("places each loan in the reminder ladder's own band", () => {
    const { overdueNow, overdueBands } = bandOverdue(
      [
        open("2026-10-06T12:00:00Z"), // 3 days late
        open("2026-09-28T12:00:00Z"), // 11 days late
        open("2026-08-01T12:00:00Z"), // 69 days late
      ],
      NOW,
    );
    expect(overdueNow).toBe(3);
    expect(overdueBands.map((b) => b.loans)).toEqual([1, 1, 1]);
  });

  it("puts a loan exactly on a band boundary in the higher band", () => {
    // Bands are half-open, matching every other range in this codebase.
    // Eight days late is the 8-21 rung, not the tail of 1-7.
    const { overdueBands } = bandOverdue([open("2026-10-01T12:00:00Z")], NOW);
    expect(overdueBands[0].loans).toBe(0);
    expect(overdueBands[1].loans).toBe(1);
  });

  it("always returns all three bands, including empty ones", () => {
    // A report axis needs the gap drawn, not skipped.
    expect(bandOverdue([], NOW).overdueBands).toHaveLength(3);
  });
});

describe("medianLoanDays", () => {
  const loan = (out: string, back: string | null) => ({
    checkedOutAt: at(out),
    returnedAt: back === null ? null : at(back),
  });

  it("ignores open loans rather than measuring them to now", () => {
    // A running loan has no duration yet. Treating today as its return
    // date would shrink the median every time someone checks something
    // out, which is the opposite of what happened.
    expect(
      medianLoanDays([
        loan("2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z"),
        loan("2026-09-01T00:00:00Z", null),
      ]),
    ).toBe(4);
  });

  it("averages the two middle values on an even count", () => {
    expect(
      medianLoanDays([
        loan("2026-09-01T00:00:00Z", "2026-09-03T00:00:00Z"),
        loan("2026-09-01T00:00:00Z", "2026-09-07T00:00:00Z"),
      ]),
    ).toBe(4);
  });

  it("is unmoved by a single enormous outlier", () => {
    // The whole reason this is a median: one rope returned in April
    // drags a mean across the entire season.
    expect(
      medianLoanDays([
        loan("2026-09-01T00:00:00Z", "2026-09-03T00:00:00Z"),
        loan("2026-09-01T00:00:00Z", "2026-09-04T00:00:00Z"),
        loan("2026-09-01T00:00:00Z", "2027-04-01T00:00:00Z"),
      ]),
    ).toBe(3);
  });

  it("returns null rather than zero with nothing closed", () => {
    // Zero days would read as "loans come straight back".
    expect(medianLoanDays([])).toBeNull();
    expect(medianLoanDays([loan("2026-09-01T00:00:00Z", null)])).toBeNull();
  });
});

describe("gearAnalyticsAction", () => {
  async function seedItem(): Promise<string> {
    const typeId = `gt_${crypto.randomUUID()}`;
    const modelId = `gm_${crypto.randomUUID()}`;
    const itemId = `gi_${crypto.randomUUID()}`;
    await getDb()
      .insert(schema.gearTypes)
      .values({ id: typeId, publicId: typeId, name: "Rope" });
    await getDb().insert(schema.gearModels).values({
      id: modelId,
      publicId: modelId,
      typeId,
      name: "Mammut 9.5",
      manufacturer: "Mammut",
    });
    await getDb()
      .insert(schema.gearItems)
      .values({ id: itemId, publicId: itemId, modelId, status: "active" });
    return itemId;
  }

  it("refuses analytics:view alone", async () => {
    await asViewer(["analytics:view"]);
    await expect(gearAnalyticsAction({ season: SEASON })).rejects.toThrow(
      /gear:read/,
    );
  });

  it("accepts gear:loan in place of gear:read", async () => {
    await asViewer(["analytics:view", "gear:loan"]);
    await expect(
      gearAnalyticsAction({ season: SEASON }),
    ).resolves.toBeDefined();
  });

  it("counts an active item with no loan as never borrowed", async () => {
    const viewer = await asViewer();
    await seedItem();
    const result = await gearAnalyticsAction({
      season: SEASON,
      now: NOW.epochMilliseconds,
    });
    expect(result.activeItems).toBe(1);
    expect(result.neverBorrowed).toBe(1);
    expect(result.outNow).toBe(0);
    expect(viewer).toBeTruthy();
  });

  it("counts an open loan as out now and excludes it from never-borrowed", async () => {
    const viewer = await asViewer();
    const itemId = await seedItem();
    await getDb()
      .insert(schema.gearLoans)
      .values({
        id: `gl_${crypto.randomUUID()}`,
        publicId: `gl_${crypto.randomUUID()}`,
        itemId,
        memberUserId: viewer,
        checkedOutAt: at("2026-09-10T12:00:00Z"),
        dueAt: at("2026-09-17T12:00:00Z"),
      });

    const result = await gearAnalyticsAction({
      season: SEASON,
      now: NOW.epochMilliseconds,
    });
    expect(result.outNow).toBe(1);
    expect(result.neverBorrowed).toBe(0);
    expect(result.loansThisSeason).toBe(1);
    // 22 days past due on the pinned clock.
    expect(result.overdueNow).toBe(1);
    expect(result.overdueBands[2].loans).toBe(1);
  });

  it("attributes a coded loan to its item's model", async () => {
    const viewer = await asViewer();
    const itemId = await seedItem();
    await getDb()
      .insert(schema.gearLoans)
      .values({
        id: `gl_${crypto.randomUUID()}`,
        publicId: `gl_${crypto.randomUUID()}`,
        itemId,
        memberUserId: viewer,
        checkedOutAt: at("2026-09-10T12:00:00Z"),
        dueAt: at("2026-09-17T12:00:00Z"),
        returnedAt: at("2026-09-14T12:00:00Z"),
      });

    const result = await gearAnalyticsAction({
      season: SEASON,
      now: NOW.epochMilliseconds,
    });
    expect(result.mostBorrowed).toEqual([
      { model: "Mammut 9.5", manufacturer: "Mammut", loans: 1 },
    ]);
  });

  it("excludes a loan opened in the previous season", async () => {
    const viewer = await asViewer();
    const itemId = await seedItem();
    await getDb()
      .insert(schema.gearLoans)
      .values({
        id: `gl_${crypto.randomUUID()}`,
        publicId: `gl_${crypto.randomUUID()}`,
        itemId,
        memberUserId: viewer,
        checkedOutAt: at("2026-07-30T12:00:00Z"),
        dueAt: at("2026-08-06T12:00:00Z"),
        returnedAt: at("2026-08-02T12:00:00Z"),
      });

    const result = await gearAnalyticsAction({
      season: SEASON,
      now: NOW.epochMilliseconds,
    });
    expect(result.loansThisSeason).toBe(0);
  });
});
