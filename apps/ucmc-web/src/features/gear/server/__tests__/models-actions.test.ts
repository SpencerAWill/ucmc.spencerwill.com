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
const {
  createGearModelAction,
  deleteGearModelAction,
  listGearModelsAction,
  setGearModelStockAction,
  updateGearModelAction,
} = await import("#/features/gear/server/models-actions.server");
const { createGearAttributeDefAction } =
  await import("#/features/gear/server/attributes-actions.server");
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
    description: null,
    tracking: "coded",
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
      description: null,
      tracking: "coded",
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

describe("updateGearModelAction write ordering", () => {
  it("commits no attribute answer when the rename is refused", async () => {
    await signInAsManager();
    const typePublicId = await createType();
    const def = await createGearAttributeDefAction({
      label: `Diameter ${crypto.randomUUID()}`,
      kind: "number",
      level: "model",
      options: null,
      unit: "mm",
      required: false,
      typePublicIds: [typePublicId],
    });
    if (!def.ok) throw new Error("def create failed");
    const taken = await createModel(typePublicId, { name: "Taken" });
    const subject = await createModel(typePublicId, {
      name: "Subject",
      attributes: [{ defPublicId: def.publicId, value: "9.8" }],
    });
    expect(taken).not.toBe(subject);

    // One submit changing both: the rename collides, so nothing at all
    // should land. The other write order committed the answer first and
    // left a partial save behind a refused submit.
    const result = await updateGearModelAction({
      publicId: subject,
      name: "Taken",
      attributes: [{ defPublicId: def.publicId, value: "10.2" }],
    });
    expect(result).toEqual({ ok: false, reason: "name_in_use" });

    const models = await listGearModelsAction({ typePublicId });
    const after = models.find((m) => m.publicId === subject);
    expect(after?.name).toBe("Subject");
    expect(after?.attributes.map((a) => a.number)).toEqual([9.8]);
  });

  it("saves attribute answers when nothing else changed", async () => {
    await signInAsManager();
    const typePublicId = await createType();
    const def = await createGearAttributeDefAction({
      label: `Diameter ${crypto.randomUUID()}`,
      kind: "number",
      level: "model",
      options: null,
      unit: "mm",
      required: false,
      typePublicIds: [typePublicId],
    });
    if (!def.ok) throw new Error("def create failed");
    const publicId = await createModel(typePublicId, {
      attributes: [{ defPublicId: def.publicId, value: "9.8" }],
    });

    // An attribute-only edit leaves `changedFields` empty, which is the
    // early-return path — the answers still have to be written.
    expect(
      await updateGearModelAction({
        publicId,
        attributes: [{ defPublicId: def.publicId, value: "10.2" }],
      }),
    ).toEqual({ ok: true });

    const models = await listGearModelsAction({ typePublicId });
    expect(
      models
        .find((m) => m.publicId === publicId)
        ?.attributes.map((a) => a.number),
    ).toEqual([10.2]);
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

describe("setGearModelStockAction", () => {
  /** The internal id, for the tests that need to plant a loan row. */
  async function modelIdOf(publicId: string): Promise<string> {
    const rows = await getDb()
      .select({ id: schema.gearModels.id })
      .from(schema.gearModels)
      .where(eq(schema.gearModels.publicId, publicId));
    const id = rows.at(0)?.id;
    if (!id) throw new Error("model not found");
    return id;
  }

  it("is the write path counted stock never had", async () => {
    await signInAsManager();
    const typePublicId = await createType();
    const publicId = await createModel(typePublicId, { tracking: "counted" });

    // Before this action existed, `gear_stock_levels` was read by
    // browse, the model list and the sweep reconciliation, and written
    // by nothing — so a counted model reported an empty bin forever.
    expect((await listGearModelsAction({ typePublicId })).at(0)?.stock).toEqual(
      [],
    );

    expect(
      await setGearModelStockAction({
        publicId,
        stock: [
          { condition: "serviceable", quantity: 38 },
          { condition: "needs_repair", quantity: 4 },
          { condition: "unsafe", quantity: 0 },
        ],
      }),
    ).toEqual({ ok: true });

    const model = (await listGearModelsAction({ typePublicId })).at(0);
    expect(model?.stock).toEqual(
      expect.arrayContaining([
        { condition: "serviceable", quantity: 38 },
        { condition: "needs_repair", quantity: 4 },
      ]),
    );
  });

  it("refuses a coded model, which counts its item rows instead", async () => {
    await signInAsManager();
    const typePublicId = await createType();
    const publicId = await createModel(typePublicId, { tracking: "coded" });

    expect(
      await setGearModelStockAction({
        publicId,
        stock: [{ condition: "serviceable", quantity: 5 }],
      }),
    ).toEqual({ ok: false, reason: "not_counted" });
  });

  it("refuses a serviceable count below what is out on loan", async () => {
    const managerId = await signInAsManager();
    const typePublicId = await createType();
    const publicId = await createModel(typePublicId, { tracking: "counted" });
    await setGearModelStockAction({
      publicId,
      stock: [{ condition: "serviceable", quantity: 38 }],
    });
    await getDb()
      .insert(schema.gearLoans)
      .values({
        id: `gl_${crypto.randomUUID()}`,
        publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        itemId: null,
        modelId: await modelIdOf(publicId),
        quantity: 6,
        quantityReturned: 0,
        memberUserId: managerId,
        checkedOutAt: Temporal.Now.instant(),
        dueAt: Temporal.Now.instant().add({ hours: 72 }),
        returnedAt: null,
      });

    // Stock counts units out on loan, so four-on-the-shelf with six out
    // is not a cave that exists: it would clamp `takeable` to zero and
    // disagree with the loan table about how many draws the club has.
    expect(
      await setGearModelStockAction({
        publicId,
        stock: [{ condition: "serviceable", quantity: 4 }],
      }),
    ).toEqual({ ok: false, reason: "below_on_loan", onLoan: 6 });

    // Six is the floor, not a refusal.
    expect(
      await setGearModelStockAction({
        publicId,
        stock: [{ condition: "serviceable", quantity: 6 }],
      }),
    ).toEqual({ ok: true });
  });

  it("audits only the buckets that moved, with their before and after", async () => {
    await signInAsManager();
    const typePublicId = await createType();
    const publicId = await createModel(typePublicId, { tracking: "counted" });
    await setGearModelStockAction({
      publicId,
      stock: [
        { condition: "serviceable", quantity: 40 },
        { condition: "needs_repair", quantity: 0 },
      ],
    });
    await getDb().delete(schema.auditLog);

    await setGearModelStockAction({
      publicId,
      stock: [
        // Unchanged: four went to the repair pile out of forty, so only
        // one bucket actually moved.
        { condition: "serviceable", quantity: 40 },
        { condition: "needs_repair", quantity: 4 },
      ],
    });

    const rows = await getDb()
      .select({
        action: schema.auditLog.action,
        metadataJson: schema.auditLog.metadataJson,
      })
      .from(schema.auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("gear_model.stock_adjusted");
    expect(JSON.parse(rows[0]?.metadataJson ?? "{}").changed).toEqual([
      { condition: "needs_repair", from: 0, to: 4 },
    ]);
  });

  it("writes nothing at all when the counts come back identical", async () => {
    await signInAsManager();
    const typePublicId = await createType();
    const publicId = await createModel(typePublicId, { tracking: "counted" });
    await setGearModelStockAction({
      publicId,
      stock: [{ condition: "serviceable", quantity: 12 }],
    });
    await getDb().delete(schema.auditLog);

    expect(
      await setGearModelStockAction({
        publicId,
        stock: [{ condition: "serviceable", quantity: 12 }],
      }),
    ).toEqual({ ok: true });
    expect(await getDb().select().from(schema.auditLog)).toHaveLength(0);
  });
});
