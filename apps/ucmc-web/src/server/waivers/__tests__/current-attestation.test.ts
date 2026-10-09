import { beforeEach, describe, expect, it } from "vitest";

import { WAIVER_VERSION } from "#/config/legal";
import { currentSeason } from "#/config/club-season";
import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";
import {
  currentlyAttestedUserIds,
  hasCurrentAttestation,
  loadMemberWaiverStatus,
} from "#/server/waivers/current-attestation.server";

/**
 * The shared waiver-standing reads, which had no tests of their own.
 *
 * They sit under `src/server/` rather than in the waivers feature
 * because three features need them, and that is exactly why they matter:
 * the gear cart's "may this member take gear out" gate, the officer
 * queue's anti-join, and the member badge all resolve through here. A
 * filter that silently stops excluding revoked attestations hands gear
 * to someone with no live waiver — and nothing else in the suite would
 * notice.
 *
 * Storage isolation in this pool is per FILE, so every table written
 * here is cleaned in `beforeEach` (see .claude/rules/testing.md).
 */

const CYCLE = currentSeason();

async function seedUser(email: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status: "approved",
    approvedAt: Temporal.Now.instant(),
  });
  await attachPrimaryEmail(id, email);
  await db.insert(schema.profiles).values({
    userId: id,
    fullName: "Test User",
    preferredName: "Testy",
    phone: "+15135551212",
    ucAffiliation: "student",
    updatedAt: Temporal.Now.instant(),
  });
  return id;
}

async function seedAttestation(opts: {
  userId: string;
  attestedBy?: string | null;
  cycle?: string;
  version?: string;
  revoked?: boolean;
  attestedAt?: Temporal.Instant;
}): Promise<void> {
  await getDb()
    .insert(schema.waiverAttestations)
    .values({
      id: `wat_${crypto.randomUUID()}`,
      userId: opts.userId,
      cycle: opts.cycle ?? CYCLE,
      version: opts.version ?? WAIVER_VERSION,
      attestedBy: opts.attestedBy ?? null,
      attestedAt: opts.attestedAt ?? Temporal.Now.instant(),
      revokedAt: opts.revoked ? Temporal.Now.instant() : null,
    });
}

beforeEach(async () => {
  const db = getDb();
  await db.delete(schema.waiverAttestations);
  await db.delete(schema.profiles);
  await db.delete(schema.userEmails);
  await db.delete(schema.users);
});

describe("hasCurrentAttestation", () => {
  it("is false for a member with no attestation at all", async () => {
    const userId = await seedUser("none@example.com");
    expect(await hasCurrentAttestation(userId)).toBe(false);
  });

  it("is true for a live attestation in the current cycle and version", async () => {
    const userId = await seedUser("live@example.com");
    await seedAttestation({ userId });
    expect(await hasCurrentAttestation(userId)).toBe(true);
  });

  it("is false once the attestation is revoked", async () => {
    // The gate the gear cart depends on. A revoked waiver must stop
    // satisfying it immediately — this is the condition whose loss
    // would hand gear to someone with no live waiver.
    const userId = await seedUser("revoked@example.com");
    await seedAttestation({ userId, revoked: true });
    expect(await hasCurrentAttestation(userId)).toBe(false);
  });

  it("is false for an attestation from a previous cycle", async () => {
    const userId = await seedUser("stale@example.com");
    await seedAttestation({ userId, cycle: "1999-00" });
    expect(await hasCurrentAttestation(userId)).toBe(false);
  });

  it("is false for an attestation against a superseded waiver version", async () => {
    // Bumping `WAIVER_VERSION` is how a re-signing is forced after the
    // legal text changes. If version weren't part of the filter, that
    // bump would silently do nothing.
    const userId = await seedUser("oldversion@example.com");
    await seedAttestation({ userId, version: `${WAIVER_VERSION}-superseded` });
    expect(await hasCurrentAttestation(userId)).toBe(false);
  });

  it("does not leak one member's attestation to another", async () => {
    const attested = await seedUser("a@example.com");
    const other = await seedUser("b@example.com");
    await seedAttestation({ userId: attested });

    expect(await hasCurrentAttestation(attested)).toBe(true);
    expect(await hasCurrentAttestation(other)).toBe(false);
  });
});

describe("currentlyAttestedUserIds", () => {
  it("lists exactly the members the officer queue should exclude", async () => {
    const live = await seedUser("live@example.com");
    const revoked = await seedUser("revoked@example.com");
    const stale = await seedUser("stale@example.com");
    await seedUser("never@example.com");

    await seedAttestation({ userId: live });
    await seedAttestation({ userId: revoked, revoked: true });
    await seedAttestation({ userId: stale, cycle: "1999-00" });

    const rows = await currentlyAttestedUserIds(CYCLE);

    // The queue anti-joins against this, so a member wrongly included
    // disappears from the officers' list of people still owing a waiver
    // — a false negative nobody is prompted to investigate.
    expect(rows.map((r) => r.userId)).toEqual([live]);
  });
});

describe("loadMemberWaiverStatus", () => {
  it("returns an unattested status, not null, when there is no row", async () => {
    // Callers render a badge from this unconditionally, so it must
    // always carry a cycle and version to show.
    const userId = await seedUser("none@example.com");
    const status = await loadMemberWaiverStatus(userId);

    expect(status).toEqual({
      cycle: CYCLE,
      version: WAIVER_VERSION,
      attested: false,
      attestedAt: null,
      attestedByName: null,
    });
  });

  it("reports who attested and when", async () => {
    const member = await seedUser("member@example.com");
    const officer = await seedUser("officer@example.com");
    const at = Temporal.Instant.fromEpochMilliseconds(1_750_000_000_000);
    await seedAttestation({
      userId: member,
      attestedBy: officer,
      attestedAt: at,
    });

    const status = await loadMemberWaiverStatus(member);

    expect(status.attested).toBe(true);
    expect(status.attestedByName).toBe("Testy");
    expect(status.attestedAt?.epochMilliseconds).toBe(at.epochMilliseconds);
  });

  it("still reads as attested when the attesting officer is gone", async () => {
    // Migration 0018 made `attested_by` ON DELETE SET NULL, and the
    // join is LEFT for exactly this: a deleted officer must not drop
    // the member's attestation. An INNER join here would silently
    // un-attest every member whose officer later left the club.
    const member = await seedUser("member@example.com");
    await seedAttestation({ userId: member, attestedBy: null });

    const status = await loadMemberWaiverStatus(member);

    expect(status.attested).toBe(true);
    expect(status.attestedByName).toBeNull();
  });

  it("ignores revoked rows and reports the newest live one", async () => {
    const member = await seedUser("member@example.com");
    const older = Temporal.Instant.fromEpochMilliseconds(1_700_000_000_000);
    const newer = Temporal.Instant.fromEpochMilliseconds(1_760_000_000_000);

    await seedAttestation({ userId: member, attestedAt: older });
    await seedAttestation({ userId: member, attestedAt: newer });
    await seedAttestation({
      userId: member,
      attestedAt: Temporal.Now.instant(),
      revoked: true,
    });

    const status = await loadMemberWaiverStatus(member);

    expect(status.attested).toBe(true);
    expect(status.attestedAt?.epochMilliseconds).toBe(newer.epochMilliseconds);
  });
});
