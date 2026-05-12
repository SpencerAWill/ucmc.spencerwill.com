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

const { createGearAction, retireGearAction } =
  await import("#/features/gear/server/gear-actions.server");
const { createGearTypeAction } =
  await import("#/features/gear/server/gear-types-actions.server");
const { createGearTagAction } =
  await import("#/features/gear/server/gear-tags-actions.server");
const {
  bulkAddGearTagsAction,
  bulkRetireGearAction,
  bulkSetGearConditionAction,
  bulkUnretireGearAction,
} = await import("#/features/gear/server/gear-bulk-actions.server");
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
  });
  if (!r.ok) throw new Error("createGearType failed");
  return r.publicId;
}

async function createGearOk(input: {
  typePublicId: string;
  code: string | null;
  condition?: schema.GearCondition;
}): Promise<string> {
  const r = await createGearAction({
    typePublicId: input.typePublicId,
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
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.gearTagAssignments);
  await db.delete(schema.gear);
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
      bulkRetireGearAction({ publicIds: [g1], reason: null }),
    ).rejects.toThrow("Forbidden: missing gear:manage");
    await expect(bulkUnretireGearAction({ publicIds: [g1] })).rejects.toThrow(
      "Forbidden: missing gear:manage",
    );
    await expect(
      bulkSetGearConditionAction({
        publicIds: [g1],
        condition: "needs_repair",
      }),
    ).rejects.toThrow("Forbidden: missing gear:manage");
    await expect(
      bulkAddGearTagsAction({ publicIds: [g1], tagPublicIds: [] }),
    ).rejects.toThrow("Forbidden: missing gear:manage");
  });

  it("rejects unauthenticated callers", async () => {
    cookieJar.clear();
    await expect(
      bulkRetireGearAction({ publicIds: ["nope"], reason: null }),
    ).rejects.toThrow("Not signed in");
  });
});

// ── bulkRetireGearAction ───────────────────────────────────────────────

describe("bulkRetireGearAction", () => {
  it("retires active pieces, skips already-retired, emits one audit row per affected", async () => {
    const managerId = await signInAsManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });
    const b = await createGearOk({ typePublicId, code: "CH2" });
    const c = await createGearOk({ typePublicId, code: "CH3" });
    // Pre-retire `c` so it shows up as skipped in the bulk call.
    await retireGearAction({ publicId: c, reason: null });

    const result = await bulkRetireGearAction({
      publicIds: [a, b, c],
      reason: "end of season",
    });
    expect(result).toEqual({ affected: 2, skipped: 1 });

    // Two bulk audit rows from this call (single-retire of `c` above
    // doesn't carry `bulk: true`).
    const bulkRetires = (await loadAuditRows("gear.retired")).filter((r) =>
      Boolean(parseMetadata(r).bulk),
    );
    expect(bulkRetires).toHaveLength(2);
    expect(bulkRetires.every((r) => r.actorUserId === managerId)).toBe(true);
    const codes = bulkRetires.map((r) => parseMetadata(r).priorCode).sort();
    expect(codes).toEqual(["CH1", "CH2"]);
    expect(
      bulkRetires.every((r) => parseMetadata(r).reason === "end of season"),
    ).toBe(true);
  });

  it("returns affected=0, skipped=N when nothing is eligible", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });
    await retireGearAction({ publicId: a, reason: null });

    const result = await bulkRetireGearAction({
      publicIds: [a, "does-not-exist"],
      reason: null,
    });
    expect(result).toEqual({ affected: 0, skipped: 2 });
    const bulkRetires = (await loadAuditRows("gear.retired")).filter((r) =>
      Boolean(parseMetadata(r).bulk),
    );
    expect(bulkRetires).toHaveLength(0);
  });
});

// ── bulkUnretireGearAction ─────────────────────────────────────────────

describe("bulkUnretireGearAction", () => {
  it("unretires only retired pieces and emits gear.unretired audit", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });
    const b = await createGearOk({ typePublicId, code: "CH2" });
    await retireGearAction({ publicId: a, reason: null });
    // `b` stays active.

    const result = await bulkUnretireGearAction({ publicIds: [a, b] });
    expect(result).toEqual({ affected: 1, skipped: 1 });
    const bulkUnretires = (await loadAuditRows("gear.unretired")).filter((r) =>
      Boolean(parseMetadata(r).bulk),
    );
    expect(bulkUnretires).toHaveLength(1);
  });
});

// ── bulkSetGearConditionAction ─────────────────────────────────────────

describe("bulkSetGearConditionAction", () => {
  it("sets the condition on every resolved piece and emits gear.updated audit", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });
    const b = await createGearOk({ typePublicId, code: "CH2" });

    const result = await bulkSetGearConditionAction({
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

// ── bulkAddGearTagsAction ──────────────────────────────────────────────

describe("bulkAddGearTagsAction", () => {
  it("attaches tags to every resolved piece and emits gear.tags_changed", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });
    const b = await createGearOk({ typePublicId, code: "CH2" });
    const tag1 = await createTagOk("outdoor");
    const tag2 = await createTagOk("winter");

    const result = await bulkAddGearTagsAction({
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

    const result = await bulkAddGearTagsAction({
      publicIds: [a],
      tagPublicIds: [],
    });
    expect(result).toEqual({ affected: 0, skipped: 1 });
    const tagChanges = await loadAuditRows("gear.tags_changed");
    expect(tagChanges).toHaveLength(0);
  });
});
