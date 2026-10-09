import { beforeEach, describe, expect, it } from "vitest";

import { getDb, schema } from "#/server/db";

const { loadMemberCounters, onTimeStreak, scoreMemberStats } =
  await import("../member-stats.server");

const at = (iso: string) => Temporal.Instant.from(iso);

/** Mid-season for cycle 2025-26: after Aug 1 2025, before May 1 2026. */
const NOW = at("2026-02-01T12:00:00Z");

async function seedMember(): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: "approved",
    });
  return id;
}

async function attest(
  userId: string,
  cycle: string,
  attestedAt: string,
  opts?: { revoked?: boolean; version?: string },
) {
  await getDb()
    .insert(schema.waiverAttestations)
    .values({
      id: `wa_${crypto.randomUUID()}`,
      userId,
      cycle,
      version: opts?.version ?? "v1",
      attestedAt: at(attestedAt),
      revokedAt: opts?.revoked ? at(attestedAt) : null,
    });
}

/** A loan needs a model to hang off; one per file is plenty. */
async function ensureModel(): Promise<string> {
  const db = getDb();
  const existing = await db
    .select({ id: schema.gearModels.id })
    .from(schema.gearModels);
  if (existing[0]) {
    return existing[0].id;
  }
  const typeId = `gt_${crypto.randomUUID()}`;
  await db.insert(schema.gearTypes).values({
    id: typeId,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    name: `Rope ${crypto.randomUUID().slice(0, 6)}`,
    description: "Test type",
  });
  const modelId = `gm_${crypto.randomUUID()}`;
  await db.insert(schema.gearModels).values({
    id: modelId,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    typeId,
    name: "Test model",
    tracking: "counted",
    description: "Test model",
  });
  return modelId;
}

async function loan(
  userId: string,
  modelId: string,
  dueAt: string,
  returnedAt: string | null,
) {
  await getDb()
    .insert(schema.gearLoans)
    .values({
      id: `gl_${crypto.randomUUID()}`,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      modelId,
      memberUserId: userId,
      checkedOutAt: at("2025-10-01T12:00:00Z"),
      dueAt: at(dueAt),
      returnedAt: returnedAt ? at(returnedAt) : null,
    });
}

beforeEach(async () => {
  // Storage isolation is per FILE, not per test, so every table this
  // file writes gets cleared here.
  const db = getDb();
  await db.delete(schema.gearInventorySweepEntries);
  await db.delete(schema.gearInventorySweeps);
  await db.delete(schema.gearLoans);
  await db.delete(schema.waiverAttestations);
  await db.delete(schema.users);
});

describe("onTimeStreak", () => {
  it("counts a return on its exact due date as on time", () => {
    // Due dates are stamped end-of-day in the club zone, so equality
    // is the common case rather than an edge one. A `<` here would
    // make Clean Return almost unwinnable.
    const t = at("2025-10-10T04:00:00Z");
    expect(onTimeStreak([{ returnedAt: t, dueAt: t }])).toBe(1);
  });

  it("stops at the first late return rather than counting around it", () => {
    expect(
      onTimeStreak([
        {
          returnedAt: at("2025-10-01T00:00:00Z"),
          dueAt: at("2025-10-02T00:00:00Z"),
        },
        {
          returnedAt: at("2025-09-01T00:00:00Z"),
          dueAt: at("2025-09-02T00:00:00Z"),
        },
        // Late — everything older than this is out of the streak.
        {
          returnedAt: at("2025-08-05T00:00:00Z"),
          dueAt: at("2025-08-01T00:00:00Z"),
        },
        {
          returnedAt: at("2025-07-01T00:00:00Z"),
          dueAt: at("2025-07-02T00:00:00Z"),
        },
      ]),
    ).toBe(2);
  });

  it("is zero when the most recent return was late", () => {
    expect(
      onTimeStreak([
        {
          returnedAt: at("2025-10-05T00:00:00Z"),
          dueAt: at("2025-10-01T00:00:00Z"),
        },
      ]),
    ).toBe(0);
  });
});

describe("loadMemberCounters", () => {
  it("gives a member with no history a clean slate", async () => {
    const userId = await seedMember();
    const counters = await loadMemberCounters(userId, NOW);
    expect(counters).toEqual({
      completedSeasons: 0,
      seasonProgress: null,
      gearLoans: 0,
      openLoans: 0,
      onTimeReturnStreak: 0,
      sweepsParticipated: 0,
    });
  });

  it("leaves a member in their first season with no closed ring", async () => {
    const userId = await seedMember();
    await attest(userId, "2025-26", "2025-09-01T04:00:00Z");

    const counters = await loadMemberCounters(userId, NOW);
    expect(counters.completedSeasons).toBe(0);
    expect(counters.seasonProgress).toBeGreaterThan(0);
    expect(counters.seasonProgress).toBeLessThan(1);
  });

  it("closes a ring for each season whose May 1 has passed", async () => {
    const userId = await seedMember();
    await attest(userId, "2023-24", "2023-09-01T04:00:00Z");
    await attest(userId, "2024-25", "2024-09-01T04:00:00Z");
    await attest(userId, "2025-26", "2025-09-01T04:00:00Z");

    const counters = await loadMemberCounters(userId, NOW);
    // Two finished, one running — exactly the "two rings plus an arc"
    // case the design is built around.
    expect(counters.completedSeasons).toBe(2);
    expect(counters.seasonProgress).toBeGreaterThan(0);
    expect(counters.seasonProgress).toBeLessThan(1);
  });

  it("shows no arc in the summer gap between seasons", async () => {
    const userId = await seedMember();
    await attest(userId, "2025-26", "2025-09-01T04:00:00Z");

    const counters = await loadMemberCounters(
      userId,
      at("2026-07-01T12:00:00Z"),
    );
    expect(counters.completedSeasons).toBe(1);
    expect(counters.seasonProgress).toBeNull();
  });

  it("ignores revoked attestations entirely", async () => {
    const userId = await seedMember();
    await attest(userId, "2024-25", "2024-09-01T04:00:00Z", { revoked: true });

    const counters = await loadMemberCounters(userId, NOW);
    expect(counters.completedSeasons).toBe(0);
    expect(counters.seasonProgress).toBeNull();
  });

  it("counts one season when a cycle was attested twice", async () => {
    const userId = await seedMember();
    // A correction mid-year leaves two live rows for one cycle. That
    // is one season of membership, not two.
    await attest(userId, "2024-25", "2024-09-01T04:00:00Z");
    await attest(userId, "2024-25", "2025-01-15T04:00:00Z");

    expect((await loadMemberCounters(userId, NOW)).completedSeasons).toBe(1);
  });

  it("anchors the arc to the first attestation of the cycle", async () => {
    const userId = await seedMember();
    await attest(userId, "2025-26", "2025-09-01T04:00:00Z");
    const early = await loadMemberCounters(userId, NOW);

    // A second, later attestation for the same cycle must not reset
    // the arc — the member was there the whole time.
    await attest(userId, "2025-26", "2026-01-20T04:00:00Z");
    const afterReattest = await loadMemberCounters(userId, NOW);

    expect(afterReattest.seasonProgress).toBe(early.seasonProgress);
  });

  it("counts a season across a waiver version bump", async () => {
    const userId = await seedMember();
    // The current-waiver GUARD filters on version; tenure must not.
    // A new PDF cannot retroactively un-attend a year.
    await attest(userId, "2023-24", "2023-09-01T04:00:00Z", { version: "v0" });
    expect((await loadMemberCounters(userId, NOW)).completedSeasons).toBe(1);
  });

  it("separates open loans from the lifetime tally", async () => {
    const userId = await seedMember();
    const modelId = await ensureModel();
    await loan(userId, modelId, "2025-10-10T04:00:00Z", "2025-10-09T04:00:00Z");
    await loan(userId, modelId, "2025-11-10T04:00:00Z", "2025-11-10T04:00:00Z");
    await loan(userId, modelId, "2026-03-01T04:00:00Z", null);

    const counters = await loadMemberCounters(userId, NOW);
    expect(counters.gearLoans).toBe(3);
    expect(counters.openLoans).toBe(1);
    // Both returns beat their due date, and the open loan is not a
    // return at all, so it neither extends nor breaks the streak.
    expect(counters.onTimeReturnStreak).toBe(2);
  });

  it("breaks the streak on the most recent late return", async () => {
    const userId = await seedMember();
    const modelId = await ensureModel();
    await loan(userId, modelId, "2025-10-10T04:00:00Z", "2025-10-09T04:00:00Z");
    // Newest return, and it is late.
    await loan(userId, modelId, "2025-12-01T04:00:00Z", "2025-12-20T04:00:00Z");

    expect((await loadMemberCounters(userId, NOW)).onTimeReturnStreak).toBe(0);
  });

  it("counts distinct sweeps, not entries", async () => {
    const userId = await seedMember();
    const modelId = await ensureModel();
    const db = getDb();
    const sweepId = `gs_${crypto.randomUUID()}`;
    await db.insert(schema.gearInventorySweeps).values({
      id: sweepId,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      startedAt: at("2025-11-01T12:00:00Z"),
      startedByUserId: userId,
    });
    // Two shelves counted in one sweep is one sweep.
    await db.insert(schema.gearInventorySweepEntries).values([
      {
        sweepId,
        modelId,
        seenAt: at("2025-11-01T13:00:00Z"),
        seenByUserId: userId,
      },
    ]);

    expect((await loadMemberCounters(userId, NOW)).sweepsParticipated).toBe(1);
  });
});

describe("scoreMemberStats", () => {
  it("awards the tenure badge matching the closed rings", async () => {
    const userId = await seedMember();
    await attest(userId, "2023-24", "2023-09-01T04:00:00Z");
    await attest(userId, "2024-25", "2024-09-01T04:00:00Z");
    await attest(userId, "2025-26", "2025-09-01T04:00:00Z");

    const counters = await loadMemberCounters(userId, NOW);
    const stats = scoreMemberStats(counters, false, true);
    // Two closed rings → both rungs reached, topping out at Pawpaw.
    // The running season must not count, or the badges would outrun
    // the rings: Hemlock is the third rung and is absent.
    expect(stats.badges.map((b) => b.key)).toEqual(["redbud", "pawpaw"]);
  });

  it("hides the raw tallies from a viewer who may not see them", async () => {
    // Badges survive the projection and the numbers do not: a badge
    // is a public achievement, an exact loan count is another
    // member's gear-desk record.
    const userId = await seedMember();
    const modelId = await ensureModel();
    await attest(userId, "2023-24", "2023-09-01T04:00:00Z");
    await loan(userId, modelId, "2025-10-10T04:00:00Z", "2025-10-09T04:00:00Z");

    const counters = await loadMemberCounters(userId, NOW);
    const hidden = scoreMemberStats(counters, false, false);

    expect(hidden.gearLoans).toBeNull();
    expect(hidden.openLoans).toBeNull();
    expect(hidden.onTimeReturnStreak).toBeNull();
    expect(hidden.sweepsParticipated).toBeNull();
    // Null, never 0 — a zero would read as "has never borrowed
    // anything", which is a claim and in this case a false one.
    expect(hidden.gearLoans).not.toBe(0);
    // Earned from the loan that is now hidden, and still shown.
    expect(hidden.badges.map((b) => b.key)).toContain("first_rental");
    expect(hidden.completedSeasons).toBe(1);
  });

  it("adds the officer badge from the role flag", async () => {
    const userId = await seedMember();
    const counters = await loadMemberCounters(userId, NOW);
    expect(
      scoreMemberStats(counters, true, true).badges.map((b) => b.key),
    ).toEqual(["officer"]);
  });
});
