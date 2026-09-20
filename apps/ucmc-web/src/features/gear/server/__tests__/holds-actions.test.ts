import { beforeEach, describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";

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

const { createGearAction, listGearAction } =
  await import("#/features/gear/server/gear-actions.server");
const { createGearTypeAction } =
  await import("#/features/gear/server/gear-types-actions.server");
const { createGearModelAction } =
  await import("#/features/gear/server/models-actions.server");
const { listGearHoldsAction, placeGearHoldAction, releaseGearHoldAction } =
  await import("#/features/gear/server/holds-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

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
  // A profile, because the holds list names who placed each hold and
  // the name comes from here.
  await getDb().insert(schema.profiles).values({
    userId: id,
    fullName: "Dana Officer",
    preferredName: "Dana",
    phone: "+15555550100",
    ucAffiliation: "student",
  });
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

async function seedCodedItem(code: string) {
  const type = await createGearTypeAction({
    name: `Harness ${crypto.randomUUID()}`,
    prefix: "CH",
    description: null,
    inspectionIntervalDays: null,
  });
  if (!type.ok) throw new Error("type failed");
  const model = await createGearModelAction({
    typePublicId: type.publicId,
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
  const item = await createGearAction({
    modelPublicId: model.publicId,
    code,
    description: null,
    thumbnailDataUrl: null,
    acquiredAt: null,
    acquisitionCostCents: null,
    notesMarkdown: null,
    condition: "serviceable",
    tagPublicIds: [],
  });
  if (!item.ok) throw new Error("item failed");
  return { typePublicId: type.publicId, modelPublicId: model.publicId, item };
}

async function seedCountedModel() {
  const type = await createGearTypeAction({
    name: `Quickdraw ${crypto.randomUUID()}`,
    prefix: "QD",
    description: null,
    inspectionIntervalDays: null,
  });
  if (!type.ok) throw new Error("type failed");
  const model = await createGearModelAction({
    typePublicId: type.publicId,
    name: `HotForge ${crypto.randomUUID()}`,
    manufacturer: null,
    tracking: "counted",
    description: null,
    msrpCents: null,
    serviceLifeYears: null,
    inspectionIntervalDays: null,
    productUrl: null,
  });
  if (!model.ok) throw new Error("model failed");
  return model.publicId;
}

function window(fromDaysFromNow: number, toDaysFromNow: number) {
  const now = Date.now();
  return {
    startsAtMs: now + fromDaysFromNow * DAY_MS,
    endsAtMs: now + toDaysFromNow * DAY_MS,
  };
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.gearHolds);
  await db.delete(schema.gearLoans);
  await db.delete(schema.gearItems);
  await db.delete(schema.gearStockLevels);
  await db.delete(schema.gearModels);
  await db.delete(schema.gearTypes);
  await db.delete(schema.userRoles);
  await db.delete(schema.profiles);
  await db.delete(schema.sessions);
  await db.delete(schema.userEmails);
  await db.delete(schema.users);
});

describe("placeGearHoldAction", () => {
  it("holds a coded piece by the code on its tag, case-insensitively", async () => {
    await signInAsManager();
    await seedCodedItem("CH93");
    const result = await placeGearHoldAction({
      gearCode: "ch93",
      reason: "Red River trip",
      ...window(-1, 3),
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("makes the piece read as on_hold, with the reason attached", async () => {
    await signInAsManager();
    await seedCodedItem("CH94");
    await placeGearHoldAction({
      gearCode: "CH94",
      reason: "Red River trip",
      ...window(-1, 3),
    });
    const list = await listGearAction({});
    const row = list.rows.find((r) => r.code === "CH94");
    // "Held for the Red River trip" is a real answer where
    // "Unavailable" is not — the reason exists for members to read.
    expect(row?.availability).toBe("on_hold");
    expect(row?.holdReason).toBe("Red River trip");
  });

  it("is invisible outside its window", async () => {
    await signInAsManager();
    await seedCodedItem("CH95");
    await placeGearHoldAction({
      gearCode: "CH95",
      reason: "Next month's trip",
      ...window(10, 20),
    });
    const list = await listGearAction({});
    // Holds self-expire and self-start; nothing sweeps them, so a
    // future hold must not block anything today.
    expect(list.rows.find((r) => r.code === "CH95")?.availability).toBe(
      "available",
    );
  });

  it("refuses a hold with no reason", async () => {
    await signInAsManager();
    await seedCodedItem("CH96");
    expect(
      await placeGearHoldAction({
        gearCode: "CH96",
        reason: "   ",
        ...window(0, 2),
      }),
    ).toEqual({ ok: false, reason: "empty_reason" });
  });

  it("refuses a window that ends before it starts", async () => {
    await signInAsManager();
    await seedCodedItem("CH97");
    expect(
      await placeGearHoldAction({
        gearCode: "CH97",
        reason: "Backwards",
        ...window(5, 1),
      }),
    ).toEqual({ ok: false, reason: "bad_window" });
  });

  it("refuses naming both a piece and a model", async () => {
    await signInAsManager();
    const seeded = await seedCodedItem("CH98");
    // The XOR is a CHECK constraint; catching it here is what lets the
    // form say something instead of surfacing a constraint error.
    expect(
      await placeGearHoldAction({
        gearCode: "CH98",
        modelPublicId: seeded.modelPublicId,
        reason: "Both",
        ...window(0, 2),
      }),
    ).toEqual({ ok: false, reason: "subject_required" });
  });

  it("refuses naming neither", async () => {
    await signInAsManager();
    expect(
      await placeGearHoldAction({ reason: "Nothing", ...window(0, 2) }),
    ).toEqual({ ok: false, reason: "subject_required" });
  });

  it("refuses a quantity hold on a coded model", async () => {
    await signInAsManager();
    const seeded = await seedCodedItem("CH99");
    // A coded model's units are held one at a time, by code — holding
    // it by quantity would pick no particular piece and block nothing
    // the availability rollup can see.
    expect(
      await placeGearHoldAction({
        modelPublicId: seeded.modelPublicId,
        quantity: 3,
        reason: "Six draws",
        ...window(0, 2),
      }),
    ).toEqual({ ok: false, reason: "not_counted" });
  });

  it("holds a quantity of a counted model", async () => {
    await signInAsManager();
    const modelPublicId = await seedCountedModel();
    expect(
      await placeGearHoldAction({
        modelPublicId,
        quantity: 6,
        reason: "Six draws for the trip",
        ...window(0, 2),
      }),
    ).toMatchObject({ ok: true });
    const holds = await listGearHoldsAction({ liveOnly: true });
    expect(holds[0]).toMatchObject({ quantity: 6, itemPublicId: null });
  });

  it("refuses to hold a retired piece", async () => {
    await signInAsManager();
    const seeded = await seedCodedItem("CH100");
    await getDb()
      .update(schema.gearItems)
      .set({ status: "retired" })
      .where(eq(schema.gearItems.publicId, seeded.item.publicId));
    expect(
      await placeGearHoldAction({
        gearCode: "CH100",
        reason: "Gone anyway",
        ...window(0, 2),
      }),
    ).toEqual({ ok: false, reason: "item_not_active" });
  });

  it("refuses a member without gear:manage", async () => {
    await signInAsManager();
    await seedCodedItem("CH101");
    await signInAsMember();
    await expect(
      placeGearHoldAction({
        gearCode: "CH101",
        reason: "Mine now",
        ...window(0, 2),
      }),
    ).rejects.toThrow();
  });
});

describe("releaseGearHoldAction", () => {
  it("frees the piece immediately", async () => {
    await signInAsManager();
    await seedCodedItem("CH102");
    const placed = await placeGearHoldAction({
      gearCode: "CH102",
      reason: "Trip cancelled",
      ...window(-1, 5),
    });
    if (!placed.ok) throw new Error("place failed");
    expect(await releaseGearHoldAction({ publicId: placed.publicId })).toEqual({
      ok: true,
    });
    const list = await listGearAction({});
    expect(list.rows.find((r) => r.code === "CH102")?.availability).toBe(
      "available",
    );
  });

  it("refuses to release the same hold twice", async () => {
    await signInAsManager();
    await seedCodedItem("CH103");
    const placed = await placeGearHoldAction({
      gearCode: "CH103",
      reason: "Trip",
      ...window(-1, 5),
    });
    if (!placed.ok) throw new Error("place failed");
    await releaseGearHoldAction({ publicId: placed.publicId });
    expect(await releaseGearHoldAction({ publicId: placed.publicId })).toEqual({
      ok: false,
      reason: "already_released",
    });
  });

  it("keeps the released hold in the list as a record", async () => {
    await signInAsManager();
    await seedCodedItem("CH104");
    const placed = await placeGearHoldAction({
      gearCode: "CH104",
      reason: "Trip",
      ...window(-1, 5),
    });
    if (!placed.ok) throw new Error("place failed");
    await releaseGearHoldAction({ publicId: placed.publicId });
    // A hold that ran its course is a record of what the cave did with
    // its gear — "who freed the trip gear" gets asked.
    const all = await listGearHoldsAction();
    expect(all).toHaveLength(1);
    expect(all[0]?.isLive).toBe(false);
    expect(await listGearHoldsAction({ liveOnly: true })).toEqual([]);
  });

  it("lists live holds above lapsed ones, and names who placed them", async () => {
    // The underlying order is by when each was placed, which floated a
    // reservation that lapsed three weeks ago above the one covering
    // Saturday — and the live ones are the only rows an officer can act
    // on. Who set it aside is the fact that decides whether to release
    // somebody else's.
    await signInAsManager();
    await seedCodedItem("CH110");
    await seedCodedItem("CH111");
    const lapsed = await placeGearHoldAction({
      gearCode: "CH110",
      reason: "Trip that already happened",
      ...window(-20, -6),
    });
    const live = await placeGearHoldAction({
      gearCode: "CH111",
      reason: "Saturday session",
      ...window(-1, 6),
    });
    if (!lapsed.ok || !live.ok) throw new Error("place failed");

    const all = await listGearHoldsAction();
    expect(all.map((h) => h.publicId)).toEqual([
      live.publicId,
      lapsed.publicId,
    ]);
    expect(all[0]?.heldByName).toBeTruthy();
  });

  it("audits both ends of a hold", async () => {
    const userId = await signInAsManager();
    await seedCodedItem("CH105");
    const placed = await placeGearHoldAction({
      gearCode: "CH105",
      reason: "Trip",
      ...window(-1, 5),
    });
    if (!placed.ok) throw new Error("place failed");
    await releaseGearHoldAction({ publicId: placed.publicId });
    const rows = await getDb().select().from(schema.auditLog);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("gear_hold.placed");
    expect(actions).toContain("gear_hold.released");
    expect(
      rows.find((r) => r.action === "gear_hold.released")?.actorUserId,
    ).toBe(userId);
  });
});
