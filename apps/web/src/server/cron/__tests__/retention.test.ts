import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb, schema } from "#/server/db";
import { getBucket } from "#/server/r2";
import {
  runRetentionSweeps,
  sweepDeactivatedAccounts,
  sweepOrphanR2Keys,
  sweepRejectedRegistrations,
  sweepRevokedWaiverAttestations,
} from "#/server/cron/retention.server";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-01T00:00:00Z");

// Random suffix for ID uniqueness across tests sharing the worker DB.
function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

async function seedUser(opts: {
  status: schema.UserStatus;
  rejectedAt?: Date | null;
  deactivatedAt?: Date | null;
}): Promise<string> {
  const id = uid("u");
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: id,
      email: `${id}@example.com`,
      status: opts.status,
      rejectedAt: opts.rejectedAt ?? null,
      deactivatedAt: opts.deactivatedAt ?? null,
    });
  return id;
}

async function seedWaiverAttestation(opts: {
  userId: string;
  revokedAt: Date | null;
}): Promise<string> {
  const id = uid("w");
  await getDb()
    .insert(schema.waiverAttestations)
    .values({
      id,
      userId: opts.userId,
      cycle: "2025-26",
      version: "v1",
      attestedAt: new Date("2025-09-01T00:00:00Z"),
      attestedBy: null,
      revokedAt: opts.revokedAt,
    });
  return id;
}

afterEach(async () => {
  // Each suite seeds its own rows; clean slate avoids interactions
  // between tests that both delete from `users`.
  const db = getDb();
  await db.delete(schema.waiverAttestations);
  await db.delete(schema.profiles);
  await db.delete(schema.landingHeroSlides);
  await db.delete(schema.landingActivities);
  await db.delete(schema.landingSettings);
  await db.delete(schema.users);

  // R2 cleanup — list everything and delete. Bounded by what tests
  // put in.
  const bucket = getBucket();
  for (const prefix of ["avatars/", "landing/"] as const) {
    let cursor: string | undefined;
    let truncated = true;
    while (truncated) {
      const page = await bucket.list({ prefix, cursor, limit: 1000 });
      if (page.objects.length > 0) {
        await bucket.delete(page.objects.map((o) => o.key));
      }
      truncated = page.truncated;
      cursor = page.truncated ? page.cursor : undefined;
    }
  }
});

describe("sweepRejectedRegistrations", () => {
  it("deletes rows older than 30 days", async () => {
    const id = await seedUser({
      status: "rejected",
      rejectedAt: new Date(NOW.getTime() - 31 * DAY_MS),
    });

    const count = await sweepRejectedRegistrations(NOW);

    expect(count).toBe(1);
    const remaining = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    expect(remaining).toHaveLength(0);
  });

  it("leaves rows younger than 30 days", async () => {
    const id = await seedUser({
      status: "rejected",
      rejectedAt: new Date(NOW.getTime() - 29 * DAY_MS),
    });

    const count = await sweepRejectedRegistrations(NOW);

    expect(count).toBe(0);
    const remaining = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    expect(remaining).toHaveLength(1);
  });

  it("skips NULL rejected_at (pre-migration rows)", async () => {
    const id = await seedUser({ status: "rejected", rejectedAt: null });

    const count = await sweepRejectedRegistrations(NOW);

    expect(count).toBe(0);
    const remaining = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    expect(remaining).toHaveLength(1);
  });

  it("ignores users with other statuses even if rejected_at is set", async () => {
    // Defensive: rejectedAt should be cleared on un-reject, but if a
    // bug ever leaves it stamped on a non-rejected row, the cron must
    // not delete the user.
    const id = await seedUser({
      status: "approved",
      rejectedAt: new Date(NOW.getTime() - 100 * DAY_MS),
    });

    const count = await sweepRejectedRegistrations(NOW);

    expect(count).toBe(0);
    const remaining = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    expect(remaining).toHaveLength(1);
  });
});

describe("sweepDeactivatedAccounts", () => {
  it("deletes rows older than 365 days", async () => {
    const id = await seedUser({
      status: "deactivated",
      deactivatedAt: new Date(NOW.getTime() - 366 * DAY_MS),
    });

    const count = await sweepDeactivatedAccounts(NOW);

    expect(count).toBe(1);
    const remaining = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    expect(remaining).toHaveLength(0);
  });

  it("leaves rows younger than 365 days", async () => {
    await seedUser({
      status: "deactivated",
      deactivatedAt: new Date(NOW.getTime() - 364 * DAY_MS),
    });

    const count = await sweepDeactivatedAccounts(NOW);

    expect(count).toBe(0);
  });

  it("skips NULL deactivated_at", async () => {
    await seedUser({ status: "deactivated", deactivatedAt: null });

    const count = await sweepDeactivatedAccounts(NOW);

    expect(count).toBe(0);
  });
});

describe("sweepRevokedWaiverAttestations", () => {
  it("deletes rows revoked more than 90 days ago", async () => {
    const userId = await seedUser({ status: "approved" });
    const attId = await seedWaiverAttestation({
      userId,
      revokedAt: new Date(NOW.getTime() - 91 * DAY_MS),
    });

    const count = await sweepRevokedWaiverAttestations(NOW);

    expect(count).toBe(1);
    const remaining = await getDb()
      .select()
      .from(schema.waiverAttestations)
      .where(eq(schema.waiverAttestations.id, attId));
    expect(remaining).toHaveLength(0);
  });

  it("leaves non-revoked attestations alone", async () => {
    const userId = await seedUser({ status: "approved" });
    await seedWaiverAttestation({ userId, revokedAt: null });

    const count = await sweepRevokedWaiverAttestations(NOW);

    expect(count).toBe(0);
  });

  it("leaves recently-revoked attestations alone", async () => {
    const userId = await seedUser({ status: "approved" });
    await seedWaiverAttestation({
      userId,
      revokedAt: new Date(NOW.getTime() - 89 * DAY_MS),
    });

    const count = await sweepRevokedWaiverAttestations(NOW);

    expect(count).toBe(0);
  });
});

describe("sweepOrphanR2Keys", () => {
  it("deletes objects under avatars/ that aren't referenced by any profile", async () => {
    const userId = await seedUser({ status: "approved" });
    const liveKey = `avatars/${userId}/live123.webp`;
    const orphanKey = `avatars/${userId}/orphan456.webp`;
    const bucket = getBucket();
    await bucket.put(liveKey, new Uint8Array([1, 2, 3]));
    await bucket.put(orphanKey, new Uint8Array([4, 5, 6]));

    await getDb().insert(schema.profiles).values({
      userId,
      fullName: "Test User",
      preferredName: "Test",
      phone: "+15555555555",
      ucAffiliation: "student",
      avatarKey: liveKey,
    });

    const count = await sweepOrphanR2Keys();

    expect(count).toBe(1);
    expect(await bucket.head(liveKey)).not.toBeNull();
    expect(await bucket.head(orphanKey)).toBeNull();
  });

  it("treats landing hero slide image keys as live", async () => {
    const liveKey = "landing/hero/live789.webp";
    const orphanKey = "landing/hero/orphanabc.webp";
    const bucket = getBucket();
    await bucket.put(liveKey, new Uint8Array([1]));
    await bucket.put(orphanKey, new Uint8Array([2]));

    await getDb()
      .insert(schema.landingHeroSlides)
      .values({
        id: uid("hs"),
        imageKey: liveKey,
        alt: "live slide",
        sortOrder: 0,
      });

    const count = await sweepOrphanR2Keys();

    expect(count).toBe(1);
    expect(await bucket.head(liveKey)).not.toBeNull();
    expect(await bucket.head(orphanKey)).toBeNull();
  });

  it("parses about.image_key / meeting.image_key from landing_settings JSON", async () => {
    const aboutKey = "landing/about/aboutdef.webp";
    const meetingKey = "landing/meeting/meetghi.webp";
    const orphanKey = "landing/about/orphanjkl.webp";
    const bucket = getBucket();
    await bucket.put(aboutKey, new Uint8Array([1]));
    await bucket.put(meetingKey, new Uint8Array([2]));
    await bucket.put(orphanKey, new Uint8Array([3]));

    await getDb()
      .insert(schema.landingSettings)
      .values([
        { key: "about.image_key", valueJson: JSON.stringify(aboutKey) },
        { key: "meeting.image_key", valueJson: JSON.stringify(meetingKey) },
      ]);

    const count = await sweepOrphanR2Keys();

    expect(count).toBe(1);
    expect(await bucket.head(aboutKey)).not.toBeNull();
    expect(await bucket.head(meetingKey)).not.toBeNull();
    expect(await bucket.head(orphanKey)).toBeNull();
  });

  it("tolerates malformed JSON in landing_settings without failing the sweep", async () => {
    const orphanKey = "landing/about/orphan.webp";
    const bucket = getBucket();
    await bucket.put(orphanKey, new Uint8Array([1]));

    await getDb()
      .insert(schema.landingSettings)
      .values({ key: "about.image_key", valueJson: "{not valid json" });

    // Should not throw — sweep continues, treating the malformed row as
    // "no live key found" and orphaning the bucket object.
    const count = await sweepOrphanR2Keys();

    expect(count).toBe(1);
    expect(await bucket.head(orphanKey)).toBeNull();
  });
});

describe("runRetentionSweeps", () => {
  it("aggregates counts across all four sweeps", async () => {
    // Seed one row that each sweep will pick up.
    const rejectedId = await seedUser({
      status: "rejected",
      rejectedAt: new Date(NOW.getTime() - 31 * DAY_MS),
    });
    const deactivatedId = await seedUser({
      status: "deactivated",
      deactivatedAt: new Date(NOW.getTime() - 366 * DAY_MS),
    });
    const userForWaiver = await seedUser({ status: "approved" });
    await seedWaiverAttestation({
      userId: userForWaiver,
      revokedAt: new Date(NOW.getTime() - 91 * DAY_MS),
    });
    await getBucket().put("avatars/orphan/x.webp", new Uint8Array([0]));

    const counts = await runRetentionSweeps(NOW);

    expect(counts).toEqual({
      rejectedRegistrations: 1,
      deactivatedAccounts: 1,
      revokedWaivers: 1,
      orphanR2Keys: 1,
    });

    // Verify side effects landed.
    const remaining = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, rejectedId));
    expect(remaining).toHaveLength(0);
    const remainingDeact = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, deactivatedId));
    expect(remainingDeact).toHaveLength(0);
  });
});
