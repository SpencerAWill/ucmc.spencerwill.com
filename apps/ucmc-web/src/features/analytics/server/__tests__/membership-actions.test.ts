import { afterEach, describe, expect, it, vi } from "vitest";

import { WAIVER_VERSION } from "#/config/legal";
import {
  bucketJoins,
  membershipAnalyticsAction,
  previousSeasonOf,
} from "#/features/analytics/server/membership-actions.server";
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
const at = (iso: string) => Temporal.Instant.from(iso);

afterEach(async () => {
  const db = getDb();
  await db.delete(schema.waiverAttestations);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
});

async function asViewer(
  permissions: string[] = ["analytics:view", "members:manage"],
) {
  const userId = `officer_${crypto.randomUUID()}`;
  // Created long before any season under test. `createdAt` defaults to
  // now, which would otherwise put the officer inside the measured
  // window and make every join count one too many — the viewer is
  // scaffolding, not part of the population being measured.
  await getDb()
    .insert(schema.users)
    .values({
      id: userId,
      publicId: userId,
      status: "approved",
      createdAt: at("2015-01-01T00:00:00Z"),
    });
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

async function seedMember(
  createdAt: string,
  status: "approved" | "pending" | "unclaimed" = "approved",
): Promise<string> {
  const id = `u_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({ id, publicId: id, status, createdAt: at(createdAt) });
  await attachPrimaryEmail(id, `${id}@example.com`);
  return id;
}

async function attest(userId: string, cycle: string) {
  await getDb()
    .insert(schema.waiverAttestations)
    .values({
      id: `w_${crypto.randomUUID()}`,
      userId,
      cycle,
      version: WAIVER_VERSION,
      attestedAt: at("2026-09-15T12:00:00Z"),
    });
}

describe("previousSeasonOf", () => {
  it("steps back one club year, keeping the YYYY-YY shape", () => {
    expect(previousSeasonOf("2026-27")).toBe("2025-26");
  });

  it("carries the century correctly across a decade boundary", () => {
    expect(previousSeasonOf("2030-31")).toBe("2029-30");
    expect(previousSeasonOf("2000-01")).toBe("1999-00");
  });
});

describe("bucketJoins", () => {
  it("emits all twelve months for every season", () => {
    // Two lines on one axis need the same twelve x positions, or one
    // skips a slot instead of sitting at zero.
    const rows = bucketJoins([
      { season: "2026-27", instants: [] },
      { season: "2025-26", instants: [] },
    ]);
    expect(rows).toHaveLength(24);
    expect(rows.filter((row) => row.season === "2026-27")).toHaveLength(12);
  });

  it("indexes August to 0 and July to 11", () => {
    const rows = bucketJoins([
      {
        season: "2026-27",
        instants: [at("2026-08-15T12:00:00Z"), at("2027-07-15T12:00:00Z")],
      },
    ]);
    expect(rows.find((r) => r.monthIndex === 0)?.joined).toBe(1);
    expect(rows.find((r) => r.monthIndex === 11)?.joined).toBe(1);
  });

  it("buckets a late-evening sign-up by the Cincinnati date", () => {
    // 2026-08-31 at 9pm EDT is 2026-09-01 in UTC. Reading the month off
    // the raw instant would move it into September — the wrong bar, and
    // on Jul 31 the wrong SEASON.
    const rows = bucketJoins([
      { season: "2026-27", instants: [at("2026-09-01T01:00:00Z")] },
    ]);
    expect(rows.find((r) => r.monthIndex === 0)?.joined).toBe(1);
    expect(rows.find((r) => r.monthIndex === 1)?.joined).toBe(0);
  });
});

describe("membershipAnalyticsAction", () => {
  it("refuses analytics:view alone", async () => {
    await asViewer(["analytics:view"]);
    await expect(membershipAnalyticsAction({ season: SEASON })).rejects.toThrow(
      /members:manage/,
    );
  });

  it("excludes officer pre-adds from the join count", async () => {
    // An unclaimed stub is an officer typing up a paper roster, not a
    // person arriving — counting them spikes whichever evening that was.
    await asViewer();
    await seedMember("2026-09-01T12:00:00Z", "approved");
    await seedMember("2026-09-01T12:00:00Z", "unclaimed");

    const result = await membershipAnalyticsAction({ season: SEASON });
    expect(result.joinedThisSeason).toBe(1);
  });

  it("counts a pending registration as a join", async () => {
    // They did register; whether an officer has acted is the funnel's
    // question, not the growth chart's.
    await asViewer();
    await seedMember("2026-09-01T12:00:00Z", "pending");

    const result = await membershipAnalyticsAction({ season: SEASON });
    expect(result.joinedThisSeason).toBe(1);
  });

  it("returns both seasons in the overlay", async () => {
    await asViewer();
    const result = await membershipAnalyticsAction({ season: SEASON });
    expect(new Set(result.joinsByMonth.map((r) => r.season))).toEqual(
      new Set(["2026-27", "2025-26"]),
    );
  });

  it("cohorts retention on last season's attesters, not on totals", async () => {
    // A brand-new member must not count as retention — that is growth
    // wearing retention's clothes.
    await asViewer();
    const stayed = await seedMember("2025-09-01T12:00:00Z");
    const left = await seedMember("2025-09-01T12:00:00Z");
    const brandNew = await seedMember("2026-09-01T12:00:00Z");
    await attest(stayed, "2025-26");
    await attest(left, "2025-26");
    await attest(stayed, SEASON);
    await attest(brandNew, SEASON);

    const result = await membershipAnalyticsAction({ season: SEASON });
    expect(result.returningFrom).toBe(2);
    expect(result.returning).toBe(1);
  });

  it("counts tenure as distinct seasons signed, not attestations", async () => {
    await asViewer();
    const veteran = await seedMember("2024-09-01T12:00:00Z");
    await attest(veteran, "2024-25");
    await attest(veteran, "2025-26");
    await attest(veteran, SEASON);
    const rookie = await seedMember("2026-09-01T12:00:00Z");
    await attest(rookie, SEASON);
    // A duplicate row in the same cycle must not promote the rookie.
    await attest(rookie, SEASON);

    const result = await membershipAnalyticsAction({ season: SEASON });
    expect(result.tenure).toEqual([
      { label: "First season", members: 1 },
      { label: "Second season", members: 0 },
      { label: "Third or more", members: 1 },
    ]);
  });

  it("reports a role with no holders as vacant", async () => {
    await asViewer();
    const result = await membershipAnalyticsAction({ season: SEASON });
    // Seeded roles exist with nobody assigned in a fresh test database,
    // and `member` / `anonymous` are excluded by construction.
    expect(result.roles.every((r) => r.role !== "member")).toBe(true);
    expect(result.roles.every((r) => r.role !== "anonymous")).toBe(true);
    expect(result.vacantRoles).toBe(
      result.roles.filter((r) => r.holders === 0).length,
    );
  });
});
