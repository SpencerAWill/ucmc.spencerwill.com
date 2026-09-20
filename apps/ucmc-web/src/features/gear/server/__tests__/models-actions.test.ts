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
const {
  createGearModelAction,
  deleteGearModelAction,
  listGearModelsAction,
  updateGearModelAction,
} = await import("#/features/gear/server/models-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function signInAsManager(): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: "approved",
    });
  await attachPrimaryEmail(id, `manager-${crypto.randomUUID()}@example.com`);
  await getDb()
    .insert(schema.userRoles)
    .values({ userId: id, roleId: "role_system_admin" })
    .onConflictDoNothing();
  cookieJar.clear();
  await openSession(id);
  return id;
}

async function createType(): Promise<string> {
  const result = await createGearTypeAction({
    name: `Quickdraw ${crypto.randomUUID()}`,
    prefix: "QD",
    description: null,
    inspectionIntervalDays: 365,
  });
  if (!result.ok) throw new Error("createGearType failed");
  return result.publicId;
}

async function createModel(
  typePublicId: string,
  overrides: Partial<Parameters<typeof createGearModelAction>[0]> = {},
) {
  const result = await createGearModelAction({
    typePublicId,
    name: `HotForge ${crypto.randomUUID()}`,
    manufacturer: "Black Diamond",
    tracking: "coded",
    description: null,
    msrpCents: null,
    serviceLifeYears: null,
    inspectionIntervalDays: null,
    productUrl: null,
    ...overrides,
  });
  if (!result.ok) throw new Error(`createGearModel failed: ${result.reason}`);
  return result.publicId;
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.gearItemAttributeValues);
  await db.delete(schema.gearModelAttributeValues);
  await db.delete(schema.gearAttributeDefTypes);
  await db.delete(schema.gearAttributeDefs);
  await db.delete(schema.gearItems);
  await db.delete(schema.gearStockLevels);
  await db.delete(schema.gearModels);
  await db.delete(schema.gearTypes);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.userEmails);
  await db.delete(schema.users);
});

describe("createGearModelAction uniqueness", () => {
  /** The action returns typed results here rather than throwing, so
   *  these call it directly instead of through `createModel`. */
  const model = (
    typePublicId: string,
    name: string,
    manufacturer: string | null,
  ) =>
    createGearModelAction({
      typePublicId,
      name,
      manufacturer,
      tracking: "coded",
      description: null,
      msrpCents: null,
      serviceLifeYears: null,
      inspectionIntervalDays: null,
      productUrl: null,
    });

  it("refuses a duplicate name when both leave the brand blank", async () => {
    await signInAsManager();
    const typePublicId = await createType();
    expect(await model(typePublicId, "Rope", null)).toMatchObject({ ok: true });

    // SQLite treats NULLs as distinct, so the plain three-column index
    // let this through: two identical unbranded models, items split
    // across them, the same product listed twice in browse.
    expect(await model(typePublicId, "Rope", null)).toEqual({
      ok: false,
      reason: "name_in_use",
    });
    // A blank string is the same answer as no answer — the action
    // normalizes it to null before the insert.
    expect(await model(typePublicId, "Rope", "   ")).toEqual({
      ok: false,
      reason: "name_in_use",
    });
  });

  it("keeps a branded model distinct from an unbranded one", async () => {
    await signInAsManager();
    const typePublicId = await createType();
    expect(await model(typePublicId, "Rope", null)).toMatchObject({ ok: true });
    expect(await model(typePublicId, "Rope", "Petzl")).toMatchObject({
      ok: true,
    });
    expect(await model(typePublicId, "Rope", "Sterling")).toMatchObject({
      ok: true,
    });
    expect(await model(typePublicId, "Rope", "Petzl")).toEqual({
      ok: false,
      reason: "name_in_use",
    });
  });
});

describe("updateGearModelAction", () => {
  it("saves the fields the model layer exists for", async () => {
    await signInAsManager();
    const typePublicId = await createType();
    const publicId = await createModel(typePublicId);
    // Until the models dialog landed, none of these had an editor —
    // they could only be set by the inline creator, which offers just
    // name and manufacturer.
    expect(
      await updateGearModelAction({
        publicId,
        msrpCents: 2495,
        serviceLifeYears: 10,
        inspectionIntervalDays: 180,
        productUrl: "https://example.com/hotforge",
      }),
    ).toEqual({ ok: true });
    const [model] = await listGearModelsAction({ typePublicId });
    expect(model).toMatchObject({
      msrpCents: 2495,
      serviceLifeYears: 10,
      inspectionIntervalDays: 180,
      productUrl: "https://example.com/hotforge",
    });
  });

  it("falls back to the type's cadence when the model has none", async () => {
    await signInAsManager();
    const typePublicId = await createType();
    await createModel(typePublicId);
    const [model] = await listGearModelsAction({ typePublicId });
    expect(model.inspectionIntervalDays).toBeNull();
    expect(model.effectiveInspectionIntervalDays).toBe(365);
  });

  it("refuses to make a model counted once it has pieces", async () => {
    await signInAsManager();
    const typePublicId = await createType();
    const modelPublicId = await createModel(typePublicId);
    const item = await createGearAction({
      modelPublicId,
      code: `QD${crypto.randomUUID().slice(0, 6)}`,
      description: null,
      thumbnailDataUrl: null,
      acquiredAt: null,
      acquisitionCostCents: null,
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [],
    });
    if (!item.ok) throw new Error("gear create failed");
    // Counted stock is quantities. Flipping would strand the item rows
    // while they still hold their codes and loan history.
    expect(
      await updateGearModelAction({
        publicId: modelPublicId,
        tracking: "counted",
      }),
    ).toEqual({ ok: false, reason: "has_items" });
  });

  it("writes no audit row when nothing changed", async () => {
    await signInAsManager();
    const typePublicId = await createType();
    const publicId = await createModel(typePublicId, { msrpCents: 2495 });
    await getDb().delete(schema.auditLog);
    await updateGearModelAction({ publicId, msrpCents: 2495 });
    expect(await getDb().select().from(schema.auditLog)).toEqual([]);
  });

  it("reports a missing model rather than throwing", async () => {
    await signInAsManager();
    expect(await updateGearModelAction({ publicId: "gone" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("deleteGearModelAction", () => {
  it("refuses while gear references it", async () => {
    await signInAsManager();
    const typePublicId = await createType();
    const modelPublicId = await createModel(typePublicId);
    const item = await createGearAction({
      modelPublicId,
      code: `QD${crypto.randomUUID().slice(0, 6)}`,
      description: null,
      thumbnailDataUrl: null,
      acquiredAt: null,
      acquisitionCostCents: null,
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [],
    });
    if (!item.ok) throw new Error("gear create failed");
    // The FK is RESTRICT; the pre-check turns it into a message the
    // officer can act on.
    expect(await deleteGearModelAction({ publicId: modelPublicId })).toEqual({
      ok: false,
      reason: "has_items",
    });
  });

  it("deletes a model nothing references", async () => {
    await signInAsManager();
    const typePublicId = await createType();
    const publicId = await createModel(typePublicId);
    expect(await deleteGearModelAction({ publicId })).toEqual({ ok: true });
    expect(await listGearModelsAction({ typePublicId })).toEqual([]);
  });
});
