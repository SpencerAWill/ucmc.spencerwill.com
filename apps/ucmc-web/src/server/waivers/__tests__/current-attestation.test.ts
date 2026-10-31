import { beforeEach, describe, expect, it } from "vitest";

import { WAIVER_VERSION } from "#/config/legal";
import { currentSeason } from "#/config/club-season";
import { getDb, schema } from "#/server/db";
import {
  currentlyAttestedUserIds,
  hasCurrentAttestation,
  loadMemberWaiverStatus,
} from "#/server/waivers/current-attestation.server";
import { createUser } from "#/test-support/factories/users";
import { createWaiverAttestation } from "#/test-support/factories/waivers";

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

beforeEach(async () => {
  const db = getDb();
  await db.delete(schema.waiverAttestations);
  await db.delete(schema.profiles);
  await db.delete(schema.userEmails);
  await db.delete(schema.users);
});

describe("hasCurrentAttestation", () => {
  it("is false for a member with no attestation at all", async () => {
    const { id: userId } = await createUser();
    expect(await hasCurrentAttestation(userId)).toBe(false);
  });

  it("is true for a live attestation in the current cycle and version", async () => {
    const { id: userId } = await createUser();
    await createWaiverAttestation({ userId });
    expect(await hasCurrentAttestation(userId)).toBe(true);
  });

  it("is false once the attestation is revoked", async () => {
    // The gate the gear cart depends on. A revoked waiver must stop
    // satisfying it immediately — this is the condition whose loss
    // would hand gear to someone with no live waiver.
    const { id: userId } = await createUser();
    await createWaiverAttestation({
      userId,
      revokedAt: Temporal.Now.instant(),
    });
    expect(await hasCurrentAttestation(userId)).toBe(false);
  });

  it("is false for an attestation from a previous cycle", async () => {
    const { id: userId } = await createUser();
    await createWaiverAttestation({ userId, cycle: "1999-00" });
    expect(await hasCurrentAttestation(userId)).toBe(false);
  });

  it("is false for an attestation against a superseded waiver version", async () => {
    // Bumping `WAIVER_VERSION` is how a re-signing is forced after the
    // legal text changes. If version weren't part of the filter, that
    // bump would silently do nothing.
    const { id: userId } = await createUser();
    await createWaiverAttestation({
      userId,
      version: `${WAIVER_VERSION}-superseded`,
    });
    expect(await hasCurrentAttestation(userId)).toBe(false);
  });

  it("does not leak one member's attestation to another", async () => {
    const { id: attested } = await createUser();
    const { id: other } = await createUser();
    await createWaiverAttestation({ userId: attested });

    expect(await hasCurrentAttestation(attested)).toBe(true);
    expect(await hasCurrentAttestation(other)).toBe(false);
  });
});

describe("currentlyAttestedUserIds", () => {
  it("lists exactly the members the officer queue should exclude", async () => {
    const { id: live } = await createUser();
    const { id: revoked } = await createUser();
    const { id: stale } = await createUser();
    await createUser();

    await createWaiverAttestation({ userId: live });
    await createWaiverAttestation({
      userId: revoked,
      revokedAt: Temporal.Now.instant(),
    });
    await createWaiverAttestation({ userId: stale, cycle: "1999-00" });

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
    const { id: userId } = await createUser();
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
    const { id: member } = await createUser();
    const { id: officer } = await createUser({
      profile: { preferredName: "Testy" },
    });
    const at = Temporal.Instant.fromEpochMilliseconds(1_750_000_000_000);
    await createWaiverAttestation({
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
    const { id: member } = await createUser();
    await createWaiverAttestation({ userId: member, attestedBy: null });

    const status = await loadMemberWaiverStatus(member);

    expect(status.attested).toBe(true);
    expect(status.attestedByName).toBeNull();
  });

  it("ignores revoked rows and reports the newest live one", async () => {
    const { id: member } = await createUser();
    const older = Temporal.Instant.fromEpochMilliseconds(1_700_000_000_000);
    const newer = Temporal.Instant.fromEpochMilliseconds(1_760_000_000_000);

    await createWaiverAttestation({ userId: member, attestedAt: older });
    await createWaiverAttestation({ userId: member, attestedAt: newer });
    await createWaiverAttestation({
      userId: member,
      attestedAt: Temporal.Now.instant(),
      revokedAt: Temporal.Now.instant(),
    });

    const status = await loadMemberWaiverStatus(member);

    expect(status.attested).toBe(true);
    expect(status.attestedAt?.epochMilliseconds).toBe(newer.epochMilliseconds);
  });
});
