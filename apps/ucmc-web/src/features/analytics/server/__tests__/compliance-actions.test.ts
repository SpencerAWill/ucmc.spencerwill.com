import { afterEach, describe, expect, it, vi } from "vitest";

import { WAIVER_VERSION } from "#/config/legal";
import { complianceAnalyticsAction } from "#/features/analytics/server/compliance-actions.server";
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

afterEach(async () => {
  const db = getDb();
  await db.delete(schema.waiverAttestations);
  await db.delete(schema.emergencyContacts);
  await db.delete(schema.events);
  await db.delete(schema.historicalOfficers);
  await db.delete(schema.users);
});

async function seedMember(
  status: (typeof schema.userStatus)[number] = "approved",
): Promise<string> {
  const id = `u_${crypto.randomUUID()}`;
  await getDb().insert(schema.users).values({ id, publicId: id, status });
  await attachPrimaryEmail(id, `${id}@example.com`);
  return id;
}

async function attest(
  userId: string,
  over: Partial<{
    cycle: string;
    version: string;
    revokedAt: Temporal.Instant | null;
    attestedAt: Temporal.Instant;
  }> = {},
) {
  await getDb()
    .insert(schema.waiverAttestations)
    .values({
      id: `w_${crypto.randomUUID()}`,
      userId,
      cycle: over.cycle ?? SEASON,
      version: over.version ?? WAIVER_VERSION,
      attestedAt:
        over.attestedAt ?? Temporal.Instant.from("2026-09-15T12:00:00Z"),
      revokedAt: over.revokedAt ?? null,
    });
}

async function asViewer(
  permissions: string[] = ["analytics:view", "waivers:view"],
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

describe("permission gate", () => {
  it("accepts waivers:verify in place of waivers:view", async () => {
    // There is no implication mechanism in the RBAC tables, so the OR
    // has to be spelled at every gate — including this one.
    await asViewer(["analytics:view", "waivers:verify"]);
    await expect(
      complianceAnalyticsAction({ season: SEASON }),
    ).resolves.toBeDefined();
  });

  it("refuses analytics:view alone", async () => {
    await asViewer(["analytics:view"]);
    await expect(complianceAnalyticsAction({ season: SEASON })).rejects.toThrow(
      /waivers:view/,
    );
  });
});

describe("waiver coverage", () => {
  it("counts approved members as the denominator, not every user", async () => {
    // A pending registration has nothing to be covered for, and
    // including it would make coverage look permanently short.
    await asViewer();
    const approved = await seedMember("approved");
    await seedMember("pending");
    await seedMember("deactivated");
    await attest(approved);

    const { waivers } = await complianceAnalyticsAction({ season: SEASON });
    // The viewer seeded by `asViewer` is approved too, and uncovered.
    expect(waivers.approved).toBe(2);
    expect(waivers.covered).toBe(1);
    expect(waivers.uncovered).toBe(1);
  });

  it("does not count a revoked attestation as coverage", async () => {
    await asViewer();
    const member = await seedMember();
    await attest(member, {
      revokedAt: Temporal.Instant.from("2026-10-01T00:00:00Z"),
    });

    const { waivers } = await complianceAnalyticsAction({ season: SEASON });
    expect(waivers.covered).toBe(0);
  });

  it("does not count an attestation under a superseded waiver version", async () => {
    // Bumping WAIVER_VERSION invalidates every live attestation by
    // design; coverage has to agree with the guard that enforces it.
    await asViewer();
    const member = await seedMember();
    await attest(member, { version: "v0" });

    const { waivers } = await complianceAnalyticsAction({ season: SEASON });
    expect(waivers.covered).toBe(0);
  });

  it("does not count last season's attestation", async () => {
    await asViewer();
    const member = await seedMember();
    await attest(member, { cycle: "2025-26" });

    const { waivers } = await complianceAnalyticsAction({ season: SEASON });
    expect(waivers.covered).toBe(0);
  });

  it("counts a twice-attested member once, not twice", async () => {
    // `attestWaiverAction` inserts a NEW row per attestation and leaves
    // earlier ones in place to preserve history, so this is the normal
    // shape of the data, not an edge case.
    //
    // This test previously asserted only `uncovered >= 0` and passed
    // over a real bug: counting rows made `covered` 2 of 2 approved
    // members while one of them had never signed, so the page said
    // "every approved member is covered" and the attention panel said
    // nothing about a member who could not legally borrow gear.
    await asViewer();
    const twice = await seedMember();
    await seedMember();
    await attest(twice);
    await attest(twice);

    const { waivers } = await complianceAnalyticsAction({ season: SEASON });
    // The viewer seeded by `asViewer` is approved and unattested too.
    expect(waivers.approved).toBe(3);
    expect(waivers.covered).toBe(1);
    expect(waivers.uncovered).toBe(2);
  });
});

describe("RSO event minimum", () => {
  const event = (over: { startsAt: string; canceledAt?: string }) => ({
    id: `e_${crypto.randomUUID()}`,
    publicId: `e_${crypto.randomUUID()}`,
    title: "Trip",
    kind: "trip" as const,
    startsAt: Temporal.Instant.from(over.startsAt),
    canceledAt: over.canceledAt ? Temporal.Instant.from(over.canceledAt) : null,
  });

  it("excludes cancelled events", async () => {
    // UC's minimum counts events HELD. Counting cancellations would let
    // the club satisfy a registration requirement with meetings that
    // never happened.
    await asViewer();
    await getDb()
      .insert(schema.events)
      .values([
        event({ startsAt: "2026-09-10T18:00:00Z" }),
        event({
          startsAt: "2026-09-17T18:00:00Z",
          canceledAt: "2026-09-16T00:00:00Z",
        }),
      ]);

    const result = await complianceAnalyticsAction({ season: SEASON });
    expect(result.eventsHeld).toBe(1);
  });

  it("counts only events inside the season", async () => {
    await asViewer();
    await getDb()
      .insert(schema.events)
      .values([
        // Jul 31 2026 belongs to the previous season.
        event({ startsAt: "2026-07-31T18:00:00Z" }),
        event({ startsAt: "2026-08-01T18:00:00Z" }),
      ]);

    const result = await complianceAnalyticsAction({ season: SEASON });
    expect(result.eventsHeld).toBe(1);
  });
});

describe("attestation timing", () => {
  it("divides each period's total by its own month count", async () => {
    // Fall is five months and Spring four, so equal totals are NOT
    // equal rates — a bar chart of raw totals flatters Fall for free.
    await asViewer();
    const a = await seedMember();
    const b = await seedMember();
    await attest(a, {
      attestedAt: Temporal.Instant.from("2026-09-02T12:00:00Z"),
    });
    await attest(b, {
      attestedAt: Temporal.Instant.from("2027-02-02T12:00:00Z"),
    });

    const { attestationsBySemester } = await complianceAnalyticsAction({
      season: SEASON,
    });
    const fall = attestationsBySemester.find((s) => s.semester === "fall");
    const spring = attestationsBySemester.find((s) => s.semester === "spring");
    expect(fall?.attestations).toBe(1);
    expect(spring?.attestations).toBe(1);
    expect(fall?.perMonth).toBeCloseTo(1 / 5);
    expect(spring?.perMonth).toBeCloseTo(1 / 4);
  });

  it("returns all three periods even when two are empty", async () => {
    // A reporting axis needs the gap drawn, not skipped.
    await asViewer();
    const { attestationsBySemester } = await complianceAnalyticsAction({
      season: SEASON,
    });
    expect(attestationsBySemester.map((s) => s.semester)).toEqual([
      "fall",
      "spring",
      "summer",
    ]);
  });
});

describe("emergency contacts", () => {
  it("counts approved members with nobody on file", async () => {
    await asViewer();
    const withContact = await seedMember();
    await seedMember();
    await getDb()
      .insert(schema.emergencyContacts)
      .values({
        id: `ec_${crypto.randomUUID()}`,
        userId: withContact,
        name: "A Friend",
        phone: "+15135551234",
        relationship: "friend",
      });

    const result = await complianceAnalyticsAction({ season: SEASON });
    // The second seeded member plus the viewer itself.
    expect(result.missingEmergencyContacts).toBe(2);
  });
});
