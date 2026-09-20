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
const { createGearModelAction, listGearModelBrowseAction } =
  await import("#/features/gear/server/models-actions.server");
const { placeGearHoldAction } =
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

async function seedType() {
  const type = await createGearTypeAction({
    name: `Harness ${crypto.randomUUID()}`,
    prefix: "CH",
    description: null,
    inspectionIntervalDays: null,
  });
  if (!type.ok) throw new Error("type failed");
  typePublicId = type.publicId;
}

async function seedModel(tracking: "coded" | "counted") {
  const model = await createGearModelAction({
    typePublicId,
    name: `Corax ${crypto.randomUUID()}`,
    manufacturer: "Petzl",
    tracking,
    description: null,
    msrpCents: null,
    serviceLifeYears: null,
    inspectionIntervalDays: null,
    productUrl: null,
  });
  if (!model.ok) throw new Error("model failed");
  const rows = await getDb()
    .select({ id: schema.gearModels.id })
    .from(schema.gearModels)
    .where(eq(schema.gearModels.publicId, model.publicId));
  return { publicId: model.publicId, id: rows.at(0)?.id ?? "" };
}

async function addItem(modelPublicId: string, code: string | null) {
  const item = await createGearAction({
    modelPublicId,
    code,
    thumbnailDataUrl: null,
    acquiredAt: null,
    acquisitionCostCents: null,
    notesMarkdown: null,
    condition: "serviceable",
    tagPublicIds: [],
  });
  if (!item.ok) throw new Error("item failed");
  return item.publicId;
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
  await db.delete(schema.sessions);
  await db.delete(schema.userEmails);
  await db.delete(schema.users);
});

describe("listGearModelBrowseAction", () => {
  it("answers '7 of 12 available' — the question the flat list couldn't", async () => {
    const managerId = await signInAsManager();
    await seedType();
    const model = await seedModel("coded");
    for (const code of ["CH1", "CH2", "CH3", "CH4"]) {
      await addItem(model.publicId, code);
    }
    // One out on loan, one flagged, one retired, one held.
    const itemRows = await getDb()
      .select({ id: schema.gearItems.id, code: schema.gearItems.code })
      .from(schema.gearItems);
    const byCode = new Map(itemRows.map((r) => [r.code, r.id]));
    await getDb()
      .insert(schema.gearLoans)
      .values({
        id: `gl_${crypto.randomUUID()}`,
        publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        itemId: byCode.get("CH1") ?? "",
        modelId: null,
        quantity: 1,
        memberUserId: managerId,
        checkedOutAt: Temporal.Now.instant(),
        dueAt: Temporal.Now.instant().add({ hours: 72 }),
        returnedAt: null,
      });
    await getDb()
      .update(schema.gearItems)
      .set({ condition: "needs_repair" })
      .where(eq(schema.gearItems.id, byCode.get("CH2") ?? ""));
    await getDb()
      .update(schema.gearItems)
      .set({ status: "retired" })
      .where(eq(schema.gearItems.id, byCode.get("CH3") ?? ""));

    const browse = await listGearModelBrowseAction();
    expect(browse).toHaveLength(1);
    // The counts come from the same availability rollup the item list
    // filters by — a fourth hand-written copy of the precedence would
    // be a fourth thing to keep in step.
    expect(browse[0]).toMatchObject({
      total: 4,
      available: 1,
      onLoan: 1,
      unavailable: 1,
      retired: 1,
      takeable: 1,
    });
  });

  it("subtracts a live hold from what a member can take", async () => {
    await signInAsManager();
    await seedType();
    const model = await seedModel("coded");
    await addItem(model.publicId, "CH10");
    await addItem(model.publicId, "CH11");
    await placeGearHoldAction({
      gearCode: "CH10",
      reason: "Red River trip",
      startsAtMs: Date.now() - DAY_MS,
      endsAtMs: Date.now() + DAY_MS,
    });
    const browse = await listGearModelBrowseAction();
    expect(browse[0]).toMatchObject({ available: 1, onHold: 1, takeable: 1 });
  });

  it("reads a counted model's number from stock, minus out and held", async () => {
    const managerId = await signInAsManager();
    await seedType();
    const model = await seedModel("counted");
    await getDb().insert(schema.gearStockLevels).values({
      modelId: model.id,
      condition: "serviceable",
      quantity: 12,
    });
    await getDb()
      .insert(schema.gearLoans)
      .values({
        id: `gl_${crypto.randomUUID()}`,
        publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        itemId: null,
        modelId: model.id,
        quantity: 4,
        quantityReturned: 1,
        memberUserId: managerId,
        checkedOutAt: Temporal.Now.instant(),
        dueAt: Temporal.Now.instant().add({ hours: 72 }),
        returnedAt: null,
      });
    await placeGearHoldAction({
      modelPublicId: model.publicId,
      quantity: 2,
      reason: "Trip",
      startsAtMs: Date.now() - DAY_MS,
      endsAtMs: Date.now() + DAY_MS,
    });
    const browse = await listGearModelBrowseAction();
    // 12 owned − 3 still out − 2 held = 7. A member borrowing draws
    // has no reason to learn the cave counts them by the binful.
    expect(browse[0]?.takeable).toBe(7);
  });

  it("doesn't promise an untagged piece the desk can't hand over", async () => {
    // An uncoded piece is genuinely `available` in the rollup — active,
    // serviceable, in the cave, nobody has it — and the item list is
    // right to say so. But nothing can scan it out, so counting it in
    // "1 of 2 available" sent a member for a harness they'd be refused.
    await signInAsManager();
    await seedType();
    const model = await seedModel("coded");
    await addItem(model.publicId, "CH40");
    await addItem(model.publicId, null);

    const browse = await listGearModelBrowseAction();
    expect(browse[0]?.available).toBe(2);
    expect(browse[0]?.takeable).toBe(1);
  });

  it("counts a counted model's flagged stock as needing attention", async () => {
    // Coded models got this from the item rollup; counted ones reported
    // nothing, so two draws waiting on a gate repair vanished from a
    // card still calling the other eighteen fine.
    await signInAsManager();
    await seedType();
    const model = await seedModel("counted");
    await getDb()
      .insert(schema.gearStockLevels)
      .values([
        { modelId: model.id, condition: "serviceable", quantity: 18 },
        { modelId: model.id, condition: "needs_repair", quantity: 2 },
      ]);

    const browse = await listGearModelBrowseAction();
    expect(browse[0]?.unavailable).toBe(2);
    expect(browse[0]?.takeable).toBe(18);
  });

  it("shows a model that has no units yet", async () => {
    await signInAsManager();
    await seedType();
    await seedModel("coded");
    const browse = await listGearModelBrowseAction();
    // Defined but unstocked is a real intermediate state during setup;
    // dropping it would make the model look like it failed to save.
    expect(browse[0]).toMatchObject({ total: 0, available: 0, takeable: 0 });
  });

  it("scopes to a type, and returns nothing for an unknown one", async () => {
    await signInAsManager();
    await seedType();
    await seedModel("coded");
    expect(await listGearModelBrowseAction({ typePublicId })).toHaveLength(1);
    expect(await listGearModelBrowseAction({ typePublicId: "nope" })).toEqual(
      [],
    );
  });

  it("searches across manufacturer, model and type", async () => {
    await signInAsManager();
    await seedType();
    await seedModel("coded");
    expect(await listGearModelBrowseAction({ q: "Petzl" })).toHaveLength(1);
    expect(await listGearModelBrowseAction({ q: "Corax" })).toHaveLength(1);
    expect(await listGearModelBrowseAction({ q: "Mammut" })).toEqual([]);
  });

  it("is readable by a plain member — this is the member-facing view", async () => {
    await signInAsManager();
    await seedType();
    await seedModel("coded");
    await signInAsMember();
    expect(await listGearModelBrowseAction()).toHaveLength(1);
  });
});
