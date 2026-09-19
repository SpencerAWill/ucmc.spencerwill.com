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

const { createGearAction, deactivateGearAction } =
  await import("#/features/gear/server/gear-actions.server");
const { createGearTypeAction } =
  await import("#/features/gear/server/gear-types-actions.server");
const { createGearTagAction } =
  await import("#/features/gear/server/gear-tags-actions.server");
const {
  bulkAddGearItemTagsAction,
  bulkDeactivateGearAction,
  bulkSetGearItemConditionAction,
  bulkReactivateGearAction,
} = await import("#/features/gear/server/gear-bulk-actions.server");
const { createGearModelAction } =
  await import("#/features/gear/server/models-actions.server");
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

async function signInAsManager(): Promise<string> {
  const userId = await seedUser(`manager-${crypto.randomUUID()}@example.com`);
  await getDb()
    .insert(schema.userRoles)
    .values({ userId, roleId: "role_system_admin" })
    .onConflictDoNothing();
  cookieJar.clear();
  await openSession(userId);
  return userId;
}

async function signInAsRegularMember(): Promise<string> {
  const userId = await seedUser(`plain-${crypto.randomUUID()}@example.com`);
  await getDb()
    .insert(schema.userRoles)
    .values({ userId, roleId: "role_member" })
    .onConflictDoNothing();
  cookieJar.clear();
  await openSession(userId);
  return userId;
}

async function createTypeOk(): Promise<string> {
  const r = await createGearTypeAction({
    name: `Harness ${crypto.randomUUID()}`,
    prefix: "CH",
    description: null,
    inspectionIntervalDays: null,
  });
  if (!r.ok) throw new Error("createGearType failed");
  return r.publicId;
}

/**
 * Creates the model on demand so a test can keep naming a type and get
 * a working item. The model layer is real in production — officers pick
 * a product — but a test asserting retire semantics shouldn't have to
 * care, so one model per type is created lazily and reused.
 */
const modelByType = new Map<string, string>();

async function modelForType(typePublicId: string): Promise<string> {
  const cached = modelByType.get(typePublicId);
  if (cached !== undefined) return cached;
  const result = await createGearModelAction({
    typePublicId,
    name: `Model for ${typePublicId}`,
    manufacturer: null,
    tracking: "coded",
    description: null,
    msrpCents: null,
    serviceLifeYears: null,
    inspectionIntervalDays: null,
    productUrl: null,
  });
  if (!result.ok) {
    throw new Error(`createGearModel failed: ${JSON.stringify(result)}`);
  }
  modelByType.set(typePublicId, result.publicId);
  return result.publicId;
}

async function createGearOk(input: {
  typePublicId: string;
  code: string | null;
  condition?: schema.GearCondition;
}): Promise<string> {
  const r = await createGearAction({
    modelPublicId: await modelForType(input.typePublicId),
    code: input.code,
    description: "Test gear",
    thumbnailDataUrl: null,
    acquiredAt: null,
    acquisitionCostCents: null,
    notesMarkdown: null,
    condition: input.condition ?? "serviceable",
    tagPublicIds: [],
  });
  if (!r.ok) throw new Error(`createGear failed: ${JSON.stringify(r)}`);
  return r.publicId;
}

async function createTagOk(name: string): Promise<string> {
  const r = await createGearTagAction({ name, visibility: "public" });
  if (!r.ok) throw new Error("createGearTag failed");
  return r.publicId;
}

async function loadAuditRows(action: string) {
  const all = await getDb().select().from(schema.auditLog);
  return all.filter((r) => r.action === action);
}

function parseMetadata(row: { metadataJson: string | null }) {
  return row.metadataJson
    ? (JSON.parse(row.metadataJson) as Record<string, unknown>)
    : {};
}

beforeEach(async () => {
  cookieJar.clear();
  modelByType.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.gearInspections);
  await db.delete(schema.gearLoans);
  await db.delete(schema.gearTagAssignments);
  await db.delete(schema.gearHolds);
  await db.delete(schema.gearInventorySweepEntries);
  await db.delete(schema.gearInventorySweeps);
  await db.delete(schema.gearItemAttributeValues);
  await db.delete(schema.gearModelAttributeValues);
  await db.delete(schema.gearAttributeDefTypes);
  await db.delete(schema.gearAttributeDefs);
  await db.delete(schema.gearItems);
  await db.delete(schema.gearStockLevels);
  await db.delete(schema.gearModels);
  await db.delete(schema.gearTags);
  await db.delete(schema.gearTypes);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.users);
});

// ── authorization ──────────────────────────────────────────────────────

describe("bulk-action authorization", () => {
  it("each bulk action rejects regular members", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk();
    const g1 = await createGearOk({ typePublicId, code: "CH1" });

    await signInAsRegularMember();
    await expect(
      bulkDeactivateGearAction({
        publicIds: [g1],
        status: "retired",
        reason: null,
      }),
    ).rejects.toThrow("Forbidden: missing gear:manage");
    await expect(bulkReactivateGearAction({ publicIds: [g1] })).rejects.toThrow(
      "Forbidden: missing gear:manage",
    );
    await expect(
      bulkSetGearItemConditionAction({
        publicIds: [g1],
        condition: "needs_repair",
      }),
    ).rejects.toThrow("Forbidden: missing gear:manage");
    await expect(
      bulkAddGearItemTagsAction({ publicIds: [g1], tagPublicIds: [] }),
    ).rejects.toThrow("Forbidden: missing gear:manage");
  });

  it("rejects unauthenticated callers", async () => {
    cookieJar.clear();
    await expect(
      bulkDeactivateGearAction({
        publicIds: ["nope"],
        status: "retired",
        reason: null,
      }),
    ).rejects.toThrow("Not signed in");
  });
});

// ── bulkDeactivateGearAction ───────────────────────────────────────────────

describe("bulkDeactivateGearAction", () => {
  it("retires active pieces, skips already-retired, emits one audit row per affected", async () => {
    const managerId = await signInAsManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });
    const b = await createGearOk({ typePublicId, code: "CH2" });
    const c = await createGearOk({ typePublicId, code: "CH3" });
    // Pre-retire `c` so it shows up as skipped in the bulk call.
    await deactivateGearAction({
      publicId: c,
      status: "retired",
      reason: null,
    });

    const result = await bulkDeactivateGearAction({
      publicIds: [a, b, c],
      status: "retired",
      reason: "end of season",
    });
    expect(result).toEqual({ affected: 2, skipped: 1 });

    // Two bulk audit rows from this call (single-retire of `c` above
    // doesn't carry `bulk: true`).
    const bulkRetires = (await loadAuditRows("gear.deactivated")).filter((r) =>
      Boolean(parseMetadata(r).bulk),
    );
    expect(bulkRetires).toHaveLength(2);
    expect(bulkRetires.every((r) => r.actorUserId === managerId)).toBe(true);
    const codes = bulkRetires.map((r) => parseMetadata(r).code).sort();
    expect(codes).toEqual(["CH1", "CH2"]);
    expect(
      bulkRetires.every((r) => parseMetadata(r).reason === "end of season"),
    ).toBe(true);
  });

  it("returns affected=0, skipped=N when nothing is eligible", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });
    await deactivateGearAction({
      publicId: a,
      status: "retired",
      reason: null,
    });

    const result = await bulkDeactivateGearAction({
      publicIds: [a, "does-not-exist"],
      status: "retired",
      reason: null,
    });
    expect(result).toEqual({ affected: 0, skipped: 2 });
    const bulkRetires = (await loadAuditRows("gear.deactivated")).filter((r) =>
      Boolean(parseMetadata(r).bulk),
    );
    expect(bulkRetires).toHaveLength(0);
  });
});

// ── bulkReactivateGearAction ─────────────────────────────────────────────

describe("bulkReactivateGearAction", () => {
  it("reactivates only deactivated pieces and emits gear.reactivated audit", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });
    const b = await createGearOk({ typePublicId, code: "CH2" });
    await deactivateGearAction({
      publicId: a,
      status: "retired",
      reason: null,
    });
    // `b` stays active.

    const result = await bulkReactivateGearAction({ publicIds: [a, b] });
    expect(result).toEqual({ affected: 1, skipped: 1 });
    const bulkUnretires = (await loadAuditRows("gear.reactivated")).filter(
      (r) => Boolean(parseMetadata(r).bulk),
    );
    expect(bulkUnretires).toHaveLength(1);
  });
});

// ── bulkSetGearItemConditionAction ─────────────────────────────────────────

describe("bulkSetGearItemConditionAction", () => {
  it("sets the condition on every resolved piece and emits gear.updated audit", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });
    const b = await createGearOk({ typePublicId, code: "CH2" });

    const result = await bulkSetGearItemConditionAction({
      publicIds: [a, b, "missing-id"],
      condition: "needs_repair",
    });
    expect(result).toEqual({ affected: 2, skipped: 1 });

    const updates = (await loadAuditRows("gear.updated")).filter((r) =>
      Boolean(parseMetadata(r).bulk),
    );
    expect(updates).toHaveLength(2);
    for (const row of updates) {
      const md = parseMetadata(row);
      expect(md.changedFields).toEqual(["condition"]);
      expect(md.condition).toBe("needs_repair");
    }
  });
});

// ── bulkAddGearItemTagsAction ──────────────────────────────────────────────

describe("bulkAddGearItemTagsAction", () => {
  it("attaches tags to every resolved piece and emits gear.tags_changed", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });
    const b = await createGearOk({ typePublicId, code: "CH2" });
    const tag1 = await createTagOk("outdoor");
    const tag2 = await createTagOk("winter");

    const result = await bulkAddGearItemTagsAction({
      publicIds: [a, b],
      tagPublicIds: [tag1, tag2],
    });
    expect(result.affected).toBe(2);

    // Tag assignments landed for both gear rows × both tags.
    const assignments = await getDb().select().from(schema.gearTagAssignments);
    expect(assignments).toHaveLength(4);

    // One audit row per gear, not per tag.
    const tagChanges = (await loadAuditRows("gear.tags_changed")).filter((r) =>
      Boolean(parseMetadata(r).bulk),
    );
    expect(tagChanges).toHaveLength(2);
    for (const row of tagChanges) {
      const md = parseMetadata(row);
      expect(md.removed).toEqual([]);
      expect(Array.isArray(md.added)).toBe(true);
      expect((md.added as string[]).length).toBe(2);
    }
  });

  it("short-circuits when no tags are supplied", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });

    const result = await bulkAddGearItemTagsAction({
      publicIds: [a],
      tagPublicIds: [],
    });
    expect(result).toEqual({ affected: 0, skipped: 1 });
    const tagChanges = await loadAuditRows("gear.tags_changed");
    expect(tagChanges).toHaveLength(0);
  });
});
