import { beforeEach, describe, expect, it } from "vitest";

import {
  CHALLENGE_TTL_SECONDS,
  consumeCeremony,
  newCeremony,
} from "#/features/auth/server/webauthn-challenge.server";
import { getDb, schema } from "#/server/db";

const NOW = Temporal.Instant.from("2026-10-19T12:00:00Z");

beforeEach(async () => {
  await getDb().delete(schema.webauthnConsumedCeremonies);
});

describe("newCeremony", () => {
  it("mints a fresh id and expires after the ceremony lifetime", () => {
    const a = newCeremony({ challenge: "abc", type: "authenticate" }, NOW);
    const b = newCeremony({ challenge: "abc", type: "authenticate" }, NOW);

    expect(a.id).not.toBe(b.id);
    expect(a.expiresAt).toBe(
      NOW.add({ seconds: CHALLENGE_TTL_SECONDS }).epochMilliseconds,
    );
  });
});

describe("consumeCeremony", () => {
  it("succeeds once, then never again", async () => {
    const ceremony = newCeremony({ challenge: "abc", type: "register" }, NOW);

    expect(await consumeCeremony(ceremony)).toBe(true);
    expect(await consumeCeremony(ceremony)).toBe(false);
  });

  // The bug #314 fixed: with a read and a separate delete, two finishes
  // racing on one ceremony could both get through. One INSERT … ON
  // CONFLICT DO NOTHING RETURNING lets exactly one of them win.
  it("lets exactly one of several concurrent consumers win", async () => {
    const ceremony = newCeremony({ challenge: "abc", type: "authenticate" });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => consumeCeremony(ceremony)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("keeps each ceremony's marker until that ceremony expires", async () => {
    const ceremony = newCeremony(
      { challenge: "abc", type: "authenticate" },
      NOW,
    );

    await consumeCeremony(ceremony);

    const rows = await getDb().select().from(schema.webauthnConsumedCeremonies);
    // Compared as epoch ms: the polyfill's Instant keeps its value in
    // internal slots, so `toEqual` on two Instants compares nothing.
    expect(
      rows.map((r) => ({ id: r.id, expiresAt: r.expiresAt.epochMilliseconds })),
    ).toEqual([{ id: ceremony.id, expiresAt: ceremony.expiresAt }]);
  });
});
