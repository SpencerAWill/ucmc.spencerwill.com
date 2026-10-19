import { beforeEach, describe, expect, it } from "vitest";

import {
  CHALLENGE_TTL_SECONDS,
  consumeChallenge,
  putChallenge,
} from "#/features/auth/server/webauthn-challenge.server";
import { getDb, schema } from "#/server/db";

const NOW = Temporal.Instant.from("2026-10-19T12:00:00Z");

beforeEach(async () => {
  await getDb().delete(schema.webauthnCeremonies);
});

describe("consumeChallenge", () => {
  it("returns the stored challenge once, then nothing", async () => {
    await putChallenge(
      "c1",
      { challenge: "abc", type: "register", userId: "user_1" },
      NOW,
    );

    expect(await consumeChallenge("c1", NOW)).toEqual({
      challenge: "abc",
      type: "register",
      userId: "user_1",
    });
    expect(await consumeChallenge("c1", NOW)).toBeNull();
  });

  // The bug #314 fixed: with a read and a separate delete, two finishes
  // racing on one ceremony could both see the challenge. One DELETE …
  // RETURNING hands the row to exactly one of them.
  it("hands a challenge to exactly one of several concurrent consumers", async () => {
    await putChallenge("c2", { challenge: "abc", type: "authenticate" }, NOW);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => consumeChallenge("c2", NOW)),
    );

    expect(results.filter((r) => r !== null)).toEqual([
      { challenge: "abc", type: "authenticate" },
    ]);
  });

  it("refuses an expired ceremony and deletes it anyway", async () => {
    await putChallenge("c3", { challenge: "abc", type: "authenticate" }, NOW);
    const expiry = NOW.add({ seconds: CHALLENGE_TTL_SECONDS });

    expect(await consumeChallenge("c3", expiry)).toBeNull();
    expect(await getDb().$count(schema.webauthnCeremonies)).toBe(0);
  });

  it("accepts a ceremony up to the instant before it expires", async () => {
    await putChallenge("c4", { challenge: "abc", type: "authenticate" }, NOW);
    const justBefore = NOW.add({ seconds: CHALLENGE_TTL_SECONDS }).subtract({
      milliseconds: 1,
    });

    expect(await consumeChallenge("c4", justBefore)).toEqual({
      challenge: "abc",
      type: "authenticate",
    });
  });

  it("returns null for a ceremony that never existed", async () => {
    expect(await consumeChallenge("missing", NOW)).toBeNull();
  });
});
