import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

// ── mocks ──────────────────────────────────────────────────────────────

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

vi.mock("#/server/rate-limit.server", () => ({
  checkAuthRateLimitByIp: async () => true,
  checkAuthRateLimitByEmail: async () => true,
}));

const { createGearAction } =
  await import("#/features/gear/server/gear-actions.server");
const { createGearTypeAction } =
  await import("#/features/gear/server/gear-types-actions.server");
const { createGearModelAction } =
  await import("#/features/gear/server/models-actions.server");
const {
  closeSweepAction,
  getOpenSweepAction,
  listUncodedSweepCandidatesAction,
  recordSweepEntryAction,
  startSweepAction,
} = await import("#/features/gear/server/sweeps-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(roleId: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: "approved",
    });
  await attachPrimaryEmail(id, `${crypto.randomUUID()}@example.com`);
  await getDb()
    .insert(schema.userRoles)
    .values({ userId: id, roleId })
    .onConflictDoNothing();
  cookieJar.clear();
  await openSession(id);
  return id;
}

const signInAsManager = () => seedUser("role_system_admin");
const signInAsMember = () => seedUser("role_member");

let typePublicId: string;
let codedModelPublicId: string;

async function seedCatalog() {
  const type = await createGearTypeAction({
    name: `Harness ${crypto.randomUUID()}`,
    prefix: "CH",
    description: null,
    inspectionIntervalDays: null,
  });
  if (!type.ok) throw new Error("type failed");
  typePublicId = type.publicId;
  const model = await createGearModelAction({
    typePublicId,
    name: `Corax ${crypto.randomUUID()}`,
    manufacturer: null,
    tracking: "coded",
    description: null,
    msrpCents: null,
    serviceLifeYears: null,
    inspectionIntervalDays: null,
    productUrl: null,
  });
  if (!model.ok) throw new Error("model failed");
  codedModelPublicId = model.publicId;
}

async function addItem(code: string | null): Promise<string> {
  const result = await createGearAction({
    modelPublicId: codedModelPublicId,
    code,
    description: null,
    thumbnailDataUrl: null,
    acquiredAt: null,
    acquisitionCostCents: null,
    notesMarkdown: null,
    condition: "serviceable",
    tagPublicIds: [],
  });
  if (!result.ok) throw new Error("item failed");
  return result.publicId;
}

async function whereaboutsOf(publicId: string) {
  const rows = await getDb()
    .select({
      whereabouts: schema.gearItems.whereabouts,
      whereaboutsAsOf: schema.gearItems.whereaboutsAsOf,
    })
    .from(schema.gearItems)
    .where(eq(schema.gearItems.publicId, publicId));
  // `.at()` rather than `[0]`: the index signature here is typed
  // non-optional, so the guard below is the only thing that makes the
  // absent case honest.
  const row = rows.at(0);
  if (!row) {
    throw new Error(`No gear item ${publicId}`);
  }
  return row;
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.gearInventorySweepEntries);
  await db.delete(schema.gearInventorySweeps);
  await db.delete(schema.gearLoans);
  await db.delete(schema.gearItems);
  await db.delete(schema.gearStockLevels);
  await db.delete(schema.gearModels);
  await db.delete(schema.gearTypes);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.userEmails);
  await db.delete(schema.users);
});

describe("startSweepAction", () => {
  it("starts one and reports the existing one on a second attempt", async () => {
    await signInAsManager();
    const first = await startSweepAction();
    if (!first.ok) throw new Error("start failed");
    // Two officers both tapping Start is how a sweep begins; the
    // second should join the count, not get an error.
    expect(await startSweepAction()).toEqual({
      ok: false,
      reason: "already_open",
      publicId: first.publicId,
    });
  });

  it("refuses a member without gear:manage", async () => {
    await signInAsMember();
    await expect(startSweepAction()).rejects.toThrow();
  });
});

describe("recordSweepEntryAction", () => {
  it("refuses when no sweep is running", async () => {
    await signInAsManager();
    await seedCatalog();
    await addItem("CH1");
    expect(await recordSweepEntryAction({ gearCode: "CH1" })).toEqual({
      ok: false,
      reason: "no_open_sweep",
    });
  });

  it("is idempotent — two people logging the same piece is normal", async () => {
    await signInAsManager();
    await seedCatalog();
    await addItem("CH2");
    await startSweepAction();
    await recordSweepEntryAction({ gearCode: "CH2" });
    await recordSweepEntryAction({ gearCode: "ch2" });
    const sweep = await getOpenSweepAction();
    expect(sweep?.entryCount).toBe(1);
  });

  it("refuses a retired piece", async () => {
    await signInAsManager();
    await seedCatalog();
    const publicId = await addItem("CH3");
    await getDb()
      .update(schema.gearItems)
      .set({ status: "retired" })
      .where(eq(schema.gearItems.publicId, publicId));
    await startSweepAction();
    expect(await recordSweepEntryAction({ gearCode: "CH3" })).toEqual({
      ok: false,
      reason: "item_not_active",
    });
  });

  it("refuses a bulk count against a coded model", async () => {
    await signInAsManager();
    await seedCatalog();
    await startSweepAction();
    // A coded model's units are logged one at a time; a bulk number
    // would claim a count its own item rows contradict.
    expect(
      await recordSweepEntryAction({
        modelPublicId: codedModelPublicId,
        quantityCounted: 5,
      }),
    ).toEqual({ ok: false, reason: "not_counted" });
  });
});

describe("closeSweepAction", () => {
  it("marks unseen active pieces missing, dated", async () => {
    await signInAsManager();
    await seedCatalog();
    const seen = await addItem("CH10");
    const unseen = await addItem("CH11");
    await startSweepAction();
    await recordSweepEntryAction({ gearCode: "CH10" });
    const result = await closeSweepAction();
    if (!result.ok) throw new Error("close failed");

    expect(result.markedMissing.map((m) => m.code)).toEqual(["CH11"]);
    expect((await whereaboutsOf(seen)).whereabouts).toBe("cave");
    const missing = await whereaboutsOf(unseen);
    expect(missing.whereabouts).toBe("missing");
    // The date is the point: "missing since when" is what makes the
    // sweep an entity rather than a per-item checkbox.
    expect(missing.whereaboutsAsOf).not.toBeNull();
  });

  it("never accuses a borrower of losing what they signed out", async () => {
    await signInAsManager();
    await seedCatalog();
    const onLoan = await addItem("CH12");
    const rows = await getDb()
      .select({ id: schema.gearItems.id })
      .from(schema.gearItems)
      .where(eq(schema.gearItems.publicId, onLoan));
    const memberId = await seedUser("role_member");
    await signInAsManager();
    await getDb()
      .insert(schema.gearLoans)
      .values({
        id: `gl_${crypto.randomUUID()}`,
        publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        itemId: rows[0]?.id ?? "",
        modelId: null,
        quantity: 1,
        memberUserId: memberId,
        checkedOutAt: Temporal.Now.instant(),
        dueAt: Temporal.Now.instant().add({ hours: 72 }),
        returnedAt: null,
      });
    await startSweepAction();
    const result = await closeSweepAction();
    if (!result.ok) throw new Error("close failed");
    expect(result.markedMissing).toEqual([]);
    expect((await whereaboutsOf(onLoan)).whereabouts).toBe("cave");
  });

  it.each(["repair", "officer"] as const)(
    "leaves gear at %s alone — absent by arrangement",
    async (whereabouts) => {
      await signInAsManager();
      await seedCatalog();
      const publicId = await addItem(`CH-${whereabouts}`);
      await getDb()
        .update(schema.gearItems)
        .set({ whereabouts })
        .where(eq(schema.gearItems.publicId, publicId));
      await startSweepAction();
      const result = await closeSweepAction();
      if (!result.ok) throw new Error("close failed");
      expect(result.markedMissing).toEqual([]);
      expect((await whereaboutsOf(publicId)).whereabouts).toBe(whereabouts);
    },
  );

  it("lets an untagged piece be logged, so it isn't missing for ever", async () => {
    // An unlabelled piece has no code, and the code box was the only way
    // in — so it went unlogged at every sweep and was marked missing at
    // every close, permanently, no matter how plainly it sat on the
    // shelf. It is pickable by publicId instead.
    await signInAsManager();
    await seedCatalog();
    const untagged = await addItem(null);
    await startSweepAction();

    const candidates = await listUncodedSweepCandidatesAction();
    expect(candidates.map((c) => c.publicId)).toContain(untagged);
    expect(candidates.find((c) => c.publicId === untagged)?.seen).toBe(false);

    const logged = await recordSweepEntryAction({ itemPublicId: untagged });
    expect(logged.ok).toBe(true);
    expect(
      (await listUncodedSweepCandidatesAction()).find(
        (c) => c.publicId === untagged,
      )?.seen,
    ).toBe(true);

    const result = await closeSweepAction();
    if (!result.ok) throw new Error("close failed");
    expect(result.markedMissing).toEqual([]);
    expect((await whereaboutsOf(untagged)).whereabouts).toBe("cave");
  });

  it("still marks an untagged piece nobody logged", async () => {
    await signInAsManager();
    await seedCatalog();
    const untagged = await addItem(null);
    await startSweepAction();
    const result = await closeSweepAction();
    if (!result.ok) throw new Error("close failed");
    expect(result.markedMissing.map((m) => m.publicId)).toEqual([untagged]);
  });

  it("leaves held gear alone — also absent by arrangement", async () => {
    // A hold is somebody saying out loud that they pulled this from the
    // bin for Saturday. Calling it missing at close made the sweep
    // contradict the hold sitting beside it in the same UI.
    await signInAsManager();
    await seedCatalog();
    const publicId = await addItem("CH-held");
    const rows = await getDb()
      .select({ id: schema.gearItems.id })
      .from(schema.gearItems)
      .where(eq(schema.gearItems.publicId, publicId));
    await getDb()
      .insert(schema.gearHolds)
      .values({
        id: `gh_${crypto.randomUUID()}`,
        publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        itemId: rows[0]?.id ?? "",
        modelId: null,
        quantity: 1,
        reason: "Held for the intro-to-climbing session",
        startsAt: Temporal.Now.instant().subtract({ hours: 24 }),
        endsAt: Temporal.Now.instant().add({ hours: 144 }),
      });
    await startSweepAction();
    const result = await closeSweepAction();
    if (!result.ok) throw new Error("close failed");
    expect(result.markedMissing).toEqual([]);
    expect((await whereaboutsOf(publicId)).whereabouts).toBe("cave");
  });

  it("still marks a piece whose hold has expired", async () => {
    // An expired hold releases itself everywhere else in the system, so
    // it must not go on shielding a piece from the count either.
    await signInAsManager();
    await seedCatalog();
    const publicId = await addItem("CH-lapsed");
    const rows = await getDb()
      .select({ id: schema.gearItems.id })
      .from(schema.gearItems)
      .where(eq(schema.gearItems.publicId, publicId));
    await getDb()
      .insert(schema.gearHolds)
      .values({
        id: `gh_${crypto.randomUUID()}`,
        publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        itemId: rows[0]?.id ?? "",
        modelId: null,
        quantity: 1,
        reason: "Trip that already happened",
        startsAt: Temporal.Now.instant().subtract({ hours: 480 }),
        endsAt: Temporal.Now.instant().subtract({ hours: 144 }),
      });
    await startSweepAction();
    const result = await closeSweepAction();
    if (!result.ok) throw new Error("close failed");
    expect(result.markedMissing).toHaveLength(1);
    expect((await whereaboutsOf(publicId)).whereabouts).toBe("missing");
  });

  it("re-stamps a piece that was already missing", async () => {
    await signInAsManager();
    await seedCatalog();
    const publicId = await addItem("CH13");
    await getDb()
      .update(schema.gearItems)
      .set({
        whereabouts: "missing",
        whereaboutsAsOf: Temporal.Instant.from("2020-01-01T00:00:00Z"),
      })
      .where(eq(schema.gearItems.publicId, publicId));
    await startSweepAction();
    const result = await closeSweepAction();
    if (!result.ok) throw new Error("close failed");
    // Still unseen, so "missing since" must move forward rather than
    // freezing at whichever sweep first noticed.
    const after = await whereaboutsOf(publicId);
    expect(
      Temporal.Instant.compare(
        after.whereaboutsAsOf ?? Temporal.Instant.from("2020-01-01T00:00:00Z"),
        Temporal.Instant.from("2021-01-01T00:00:00Z"),
      ),
    ).toBe(1);
  });

  it("reports a counted shortfall without writing anything off", async () => {
    await signInAsManager();
    await seedCatalog();
    const counted = await createGearModelAction({
      typePublicId,
      name: `HotForge ${crypto.randomUUID()}`,
      manufacturer: null,
      tracking: "counted",
      description: null,
      msrpCents: null,
      serviceLifeYears: null,
      inspectionIntervalDays: null,
      productUrl: null,
    });
    if (!counted.ok) throw new Error("model failed");
    const modelRows = await getDb()
      .select({ id: schema.gearModels.id })
      .from(schema.gearModels)
      .where(eq(schema.gearModels.publicId, counted.publicId));
    await getDb()
      .insert(schema.gearStockLevels)
      .values({
        modelId: modelRows[0]?.id ?? "",
        condition: "serviceable",
        quantity: 12,
      });
    await startSweepAction();
    await recordSweepEntryAction({
      modelPublicId: counted.publicId,
      quantityCounted: 8,
    });
    const result = await closeSweepAction();
    if (!result.ok) throw new Error("close failed");
    // A miscount is likelier than four lost draws, so the shortfall is
    // reported for somebody to judge — stock is untouched.
    expect(result.shortfalls).toHaveLength(1);
    expect(result.shortfalls[0]).toMatchObject({
      expected: 12,
      counted: 8,
      onLoan: 0,
      shortfall: 4,
    });
    const stock = await getDb().select().from(schema.gearStockLevels);
    expect(stock[0]?.quantity).toBe(12);
  });

  it("counts on-loan quantity toward a counted model", async () => {
    await signInAsManager();
    await seedCatalog();
    const counted = await createGearModelAction({
      typePublicId,
      name: `HotForge ${crypto.randomUUID()}`,
      manufacturer: null,
      tracking: "counted",
      description: null,
      msrpCents: null,
      serviceLifeYears: null,
      inspectionIntervalDays: null,
      productUrl: null,
    });
    if (!counted.ok) throw new Error("model failed");
    const modelRows = await getDb()
      .select({ id: schema.gearModels.id })
      .from(schema.gearModels)
      .where(eq(schema.gearModels.publicId, counted.publicId));
    const modelId = modelRows[0]?.id ?? "";
    await getDb()
      .insert(schema.gearStockLevels)
      .values({ modelId, condition: "serviceable", quantity: 12 });
    const memberId = await seedUser("role_member");
    await signInAsManager();
    await getDb()
      .insert(schema.gearLoans)
      .values({
        id: `gl_${crypto.randomUUID()}`,
        publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        itemId: null,
        modelId,
        quantity: 4,
        quantityReturned: 0,
        memberUserId: memberId,
        checkedOutAt: Temporal.Now.instant(),
        dueAt: Temporal.Now.instant().add({ hours: 72 }),
        returnedAt: null,
      });
    await startSweepAction();
    await recordSweepEntryAction({
      modelPublicId: counted.publicId,
      quantityCounted: 8,
    });
    const result = await closeSweepAction();
    if (!result.ok) throw new Error("close failed");
    // 8 in the bin + 4 out on loan = the 12 owned. Nothing is short.
    expect(result.shortfalls).toEqual([]);
  });

  it("refuses to close when nothing is open", async () => {
    await signInAsManager();
    expect(await closeSweepAction()).toEqual({
      ok: false,
      reason: "no_open_sweep",
    });
  });

  it("audits both ends of the sweep", async () => {
    await signInAsManager();
    await seedCatalog();
    await startSweepAction();
    await closeSweepAction({ notes: "Wednesday count" });
    const actions = (await getDb().select().from(schema.auditLog)).map(
      (r) => r.action,
    );
    expect(actions).toContain("gear_sweep.started");
    expect(actions).toContain("gear_sweep.closed");
  });
});
