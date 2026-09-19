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

const {
  createGearAttributeDefAction,
  deleteGearAttributeDefAction,
  listGearAttributeDefsAction,
  updateGearAttributeDefAction,
} = await import("#/features/gear/server/attributes-actions.server");
const { createGearTypeAction } =
  await import("#/features/gear/server/gear-types-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(email: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: "approved",
    });
  await attachPrimaryEmail(id, email);
  return id;
}

async function assignRole(userId: string, roleId: string): Promise<void> {
  await getDb()
    .insert(schema.userRoles)
    .values({ userId, roleId })
    .onConflictDoNothing();
}

async function signInAsManager(): Promise<string> {
  const userId = await seedUser(`manager-${crypto.randomUUID()}@example.com`);
  await assignRole(userId, "role_system_admin");
  cookieJar.clear();
  await openSession(userId);
  return userId;
}

async function signInAsRegularMember(): Promise<string> {
  const userId = await seedUser(`plain-${crypto.randomUUID()}@example.com`);
  await assignRole(userId, "role_member");
  cookieJar.clear();
  await openSession(userId);
  return userId;
}

async function createType(name: string): Promise<string> {
  const result = await createGearTypeAction({
    name,
    prefix: null,
    description: null,
    inspectionIntervalDays: null,
  });
  if (!result.ok) throw new Error(`createGearType failed for ${name}`);
  return result.publicId;
}

async function createDef(
  overrides: Partial<Parameters<typeof createGearAttributeDefAction>[0]> = {},
) {
  return createGearAttributeDefAction({
    label: "Size",
    kind: "select",
    level: "item",
    options: ["S", "M", "L"],
    unit: null,
    required: false,
    typePublicIds: [],
    ...overrides,
  });
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
  await db.delete(schema.gearModels);
  await db.delete(schema.gearTypes);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.userEmails);
  await db.delete(schema.users);
});

describe("createGearAttributeDefAction", () => {
  it("derives a stable machine key from the label", async () => {
    await signInAsManager();
    const result = await createDef({ label: "Rope diameter", kind: "number" });
    expect(result).toMatchObject({ ok: true, key: "rope_diameter" });
  });

  it("refuses a second definition with a colliding key", async () => {
    await signInAsManager();
    await createDef({ label: "Size" });
    // "size" and " Size " derive the same key, and the key is what
    // every stored answer points at.
    const second = await createDef({ label: " size " });
    expect(second).toEqual({ ok: false, reason: "key_in_use" });
  });

  it("refuses a choice list with no options", async () => {
    await signInAsManager();
    // An empty dropdown renders as a control nobody can answer, which
    // looks like a bug in the form rather than a gap in the definition.
    expect(await createDef({ options: [] })).toEqual({
      ok: false,
      reason: "needs_options",
    });
    expect(await createDef({ options: null })).toEqual({
      ok: false,
      reason: "needs_options",
    });
  });

  it("keeps option order and drops blanks and duplicates", async () => {
    await signInAsManager();
    const created = await createDef({
      options: ["XL", "S", "  ", "M", "S"],
    });
    if (!created.ok) throw new Error("create failed");
    const [def] = await listGearAttributeDefsAction();
    // Order is display order, not sort order: alphabetising sizes
    // yields L, M, S, XL, which reads as a bug.
    expect(def.options).toEqual(["XL", "S", "M"]);
  });

  it("keeps the unit only where it means something", async () => {
    await signInAsManager();
    await createDef({ label: "Diameter", kind: "number", unit: " mm " });
    await createDef({ label: "Colour", kind: "text", unit: "mm" });
    const defs = await listGearAttributeDefsAction();
    expect(defs.find((d) => d.key === "diameter")?.unit).toBe("mm");
    // A unit on free text would print "blue mm".
    expect(defs.find((d) => d.key === "colour")?.unit).toBeNull();
  });

  it("refuses a member without gear:manage", async () => {
    await signInAsRegularMember();
    await expect(createDef()).rejects.toThrow();
  });

  it("records who introduced the attribute", async () => {
    const userId = await signInAsManager();
    await createDef({ label: "Size" });
    const rows = await getDb().select().from(schema.auditLog);
    const event = rows.find((r) => r.action === "gear_attribute.created");
    expect(event?.actorUserId).toBe(userId);
  });
});

describe("listGearAttributeDefsAction", () => {
  it("scopes to a type, and returns nothing for an unknown one", async () => {
    await signInAsManager();
    const harness = await createType("Harness");
    const rope = await createType("Rope");
    await createDef({ label: "Size", typePublicIds: [harness] });
    await createDef({
      label: "Diameter",
      kind: "number",
      options: null,
      typePublicIds: [rope],
    });

    const forHarness = await listGearAttributeDefsAction({
      typePublicId: harness,
    });
    expect(forHarness.map((d) => d.key)).toEqual(["size"]);

    // Dropping an unrecognised filter would show a harness form every
    // attribute in the club.
    expect(
      await listGearAttributeDefsAction({ typePublicId: "nonexistent" }),
    ).toEqual([]);
  });

  it("hides archived definitions unless asked", async () => {
    await signInAsManager();
    const created = await createDef({ label: "Size" });
    if (!created.ok) throw new Error("create failed");
    await updateGearAttributeDefAction({
      publicId: created.publicId,
      archived: true,
    });
    expect(await listGearAttributeDefsAction()).toEqual([]);
    const all = await listGearAttributeDefsAction({ includeArchived: true });
    expect(all).toHaveLength(1);
    expect(all[0]?.archived).toBe(true);
  });

  it("is readable by a plain member — the facets are member-facing", async () => {
    await signInAsManager();
    await createDef({ label: "Size" });
    await signInAsRegularMember();
    expect(await listGearAttributeDefsAction()).toHaveLength(1);
  });
});

describe("updateGearAttributeDefAction", () => {
  it("does not re-derive the key from a relabel", async () => {
    await signInAsManager();
    const created = await createDef({ label: "Size" });
    if (!created.ok) throw new Error("create failed");
    await updateGearAttributeDefAction({
      publicId: created.publicId,
      label: "Harness size",
    });
    const [def] = await listGearAttributeDefsAction();
    // Every stored answer points at the key. Re-deriving it would
    // orphan them all on a rename.
    expect(def.key).toBe("size");
    expect(def.label).toBe("Harness size");
  });

  it("replaces type attachments wholesale", async () => {
    await signInAsManager();
    const harness = await createType("Harness");
    const jacket = await createType("Jacket");
    const created = await createDef({
      label: "Size",
      typePublicIds: [harness],
    });
    if (!created.ok) throw new Error("create failed");
    await updateGearAttributeDefAction({
      publicId: created.publicId,
      typePublicIds: [jacket],
    });
    const [def] = await listGearAttributeDefsAction();
    expect(def.typePublicIds).toEqual([jacket]);
  });

  it("archives and restores", async () => {
    await signInAsManager();
    const created = await createDef({ label: "Size" });
    if (!created.ok) throw new Error("create failed");
    await updateGearAttributeDefAction({
      publicId: created.publicId,
      archived: true,
    });
    await updateGearAttributeDefAction({
      publicId: created.publicId,
      archived: false,
    });
    expect(await listGearAttributeDefsAction()).toHaveLength(1);
  });

  it("refuses to empty a choice list", async () => {
    await signInAsManager();
    const created = await createDef({ label: "Size" });
    if (!created.ok) throw new Error("create failed");
    expect(
      await updateGearAttributeDefAction({
        publicId: created.publicId,
        options: [],
      }),
    ).toEqual({ ok: false, reason: "needs_options" });
  });

  it("writes no audit row when nothing actually changed", async () => {
    await signInAsManager();
    const created = await createDef({ label: "Size" });
    if (!created.ok) throw new Error("create failed");
    await getDb().delete(schema.auditLog);
    await updateGearAttributeDefAction({
      publicId: created.publicId,
      label: "Size",
      required: false,
    });
    expect(await getDb().select().from(schema.auditLog)).toEqual([]);
  });
});

describe("deleteGearAttributeDefAction", () => {
  it("deletes a definition nothing has answered", async () => {
    await signInAsManager();
    const created = await createDef({ label: "Size" });
    if (!created.ok) throw new Error("create failed");
    expect(
      await deleteGearAttributeDefAction({ publicId: created.publicId }),
    ).toEqual({ ok: true });
    expect(await listGearAttributeDefsAction()).toEqual([]);
  });

  it("refuses while answers exist, and says how many", async () => {
    await signInAsManager();
    const created = await createDef({ label: "Size" });
    if (!created.ok) throw new Error("create failed");
    const db = getDb();
    const [defRow] = await db.select().from(schema.gearAttributeDefs);
    await db.insert(schema.gearTypes).values({
      id: "gt_del",
      publicId: "gtdel00000001",
      name: "Harness",
    });
    await db.insert(schema.gearModels).values({
      id: "gm_del",
      publicId: "gmdel00000001",
      typeId: "gt_del",
      name: "Corax",
      tracking: "coded",
    });
    await db.insert(schema.gearModelAttributeValues).values({
      modelId: "gm_del",
      defId: defRow.id,
      valueText: "M",
      valueNumber: null,
    });
    // The FK cascades, so the database would happily take the answer
    // with it. Refusing and pointing at archive is the whole guard.
    expect(
      await deleteGearAttributeDefAction({ publicId: created.publicId }),
    ).toEqual({ ok: false, reason: "has_values", valueCount: 1 });
    expect(
      await listGearAttributeDefsAction({ includeArchived: true }),
    ).toHaveLength(1);
  });

  it("refuses a member without gear:manage", async () => {
    await signInAsManager();
    const created = await createDef({ label: "Size" });
    if (!created.ok) throw new Error("create failed");
    await signInAsRegularMember();
    await expect(
      deleteGearAttributeDefAction({ publicId: created.publicId }),
    ).rejects.toThrow();
  });
});
