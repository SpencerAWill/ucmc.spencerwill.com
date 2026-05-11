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

const {
  createGearAction,
  editGearAction,
  getGearDetailAction,
  listGearAction,
  retireGearAction,
  suggestCodeForTypeAction,
  unretireGearAction,
} = await import("#/features/gear/server/gear-actions.server");
const {
  createGearTypeAction,
  deleteGearTypeAction,
  editGearTypeAction,
  listGearTypesAction,
} = await import("#/features/gear/server/gear-types-actions.server");
const {
  createGearTagAction,
  deleteGearTagAction,
  editGearTagAction,
  listGearTagsAction,
} = await import("#/features/gear/server/gear-tags-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(
  email: string,
  opts?: { status?: schema.UserStatus },
): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: opts?.status ?? "approved",
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

async function signInAs(userId: string): Promise<void> {
  cookieJar.clear();
  await openSession(userId);
}

async function signInAsManager(): Promise<string> {
  const userId = await seedUser("manager@example.com");
  await assignRole(userId, "role_system_admin");
  await signInAs(userId);
  return userId;
}

async function signInAsRegularMember(): Promise<string> {
  const userId = await seedUser("plain@example.com");
  await assignRole(userId, "role_member");
  await signInAs(userId);
  return userId;
}

async function createTypeOk(input: {
  name: string;
  prefix?: string | null;
  description?: string | null;
}): Promise<string> {
  const result = await createGearTypeAction({
    name: input.name,
    prefix: input.prefix ?? null,
    description: input.description ?? null,
  });
  if (!result.ok) {
    throw new Error(`createGearType failed: ${result.reason}`);
  }
  return result.publicId;
}

async function createGearOk(input: {
  typePublicId: string;
  code?: string | null;
  description?: string | null;
  tagPublicIds?: string[];
  condition?: schema.GearCondition;
}): Promise<string> {
  const result = await createGearAction({
    typePublicId: input.typePublicId,
    code: input.code ?? null,
    description: input.description ?? null,
    acquiredAt: null,
    acquisitionCostCents: null,
    notesMarkdown: null,
    condition: input.condition ?? "serviceable",
    tagPublicIds: input.tagPublicIds ?? [],
  });
  if (!result.ok) {
    throw new Error(`createGear failed: ${JSON.stringify(result)}`);
  }
  return result.publicId;
}

async function createTagOk(name: string): Promise<string> {
  const result = await createGearTagAction({ name });
  if (!result.ok) {
    throw new Error(`createGearTag failed: ${JSON.stringify(result)}`);
  }
  return result.publicId;
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  // Order matters: cascade FKs do the rest, but auditLog has SET NULL
  // on actor/target so it survives user deletes and must be cleared
  // explicitly.
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

describe("authorization", () => {
  it("rejects unauthenticated callers on list", async () => {
    cookieJar.clear();
    await expect(listGearAction({})).rejects.toThrow("Not signed in");
  });

  it("rejects regular members on create", async () => {
    await signInAsRegularMember();
    await expect(
      createGearAction({
        typePublicId: "nope",
        code: null,
        description: null,
        acquiredAt: null,
        acquisitionCostCents: null,
        notesMarkdown: null,
        condition: "serviceable",
        tagPublicIds: [],
      }),
    ).rejects.toThrow("Forbidden: missing gear:manage");
  });

  it("lets regular members browse the directory", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    await createGearOk({ typePublicId, code: "CH1" });

    await signInAsRegularMember();
    const list = await listGearAction({});
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]?.code).toBe("CH1");
  });

  it("strips acquisitionCostCents for non-manager readers", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    // Seed gear with a non-null cost so the strip is observable.
    const created = await createGearAction({
      typePublicId,
      code: "CH1",
      description: null,
      acquiredAt: null,
      acquisitionCostCents: 6000,
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [],
    });
    if (!created.ok) throw new Error("seed failed");

    // Manager view: cost is present.
    const managerList = await listGearAction({});
    expect(managerList.rows[0]?.acquisitionCostCents).toBe(6000);
    const managerDetail = await getGearDetailAction({
      publicId: created.publicId,
    });
    expect(managerDetail.acquisitionCostCents).toBe(6000);

    // Regular member view: cost is null.
    await signInAsRegularMember();
    const memberList = await listGearAction({});
    expect(memberList.rows[0]?.acquisitionCostCents).toBeNull();
    const memberDetail = await getGearDetailAction({
      publicId: created.publicId,
    });
    expect(memberDetail.acquisitionCostCents).toBeNull();
  });
});

// ── types ──────────────────────────────────────────────────────────────

describe("gear types", () => {
  it("creates, lists, and edits a type", async () => {
    await signInAsManager();
    const publicId = await createTypeOk({
      name: "Climbing Harness",
      prefix: "CH",
    });
    const types = await listGearTypesAction();
    expect(types).toHaveLength(1);
    expect(types[0]?.name).toBe("Climbing Harness");

    const edit = await editGearTypeAction({
      publicId,
      name: "Climbing Harness",
      prefix: "HRN",
      description: null,
    });
    expect(edit.ok).toBe(true);

    const types2 = await listGearTypesAction();
    expect(types2[0]?.prefix).toBe("HRN");
  });

  it("rejects duplicate type names", async () => {
    await signInAsManager();
    await createTypeOk({ name: "Harness", prefix: "CH" });
    const dup = await createGearTypeAction({
      name: "Harness",
      prefix: "X",
      description: null,
    });
    expect(dup).toEqual({ ok: false, reason: "name_in_use" });
  });

  it("blocks deletion while gear references the type", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    await createGearOk({ typePublicId, code: "CH1" });
    const del = await deleteGearTypeAction({ publicId: typePublicId });
    expect(del).toEqual({ ok: false, reason: "in_use" });
  });
});

// ── create / edit / retire / unretire ──────────────────────────────────

describe("gear lifecycle", () => {
  it("creates a row, emits audit, returns publicId", async () => {
    const actorId = await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const publicId = await createGearOk({ typePublicId, code: "CH93" });

    const detail = await getGearDetailAction({ publicId });
    expect(detail.code).toBe("CH93");
    expect(detail.lifecycle).toBe("active");
    expect(detail.condition).toBe("serviceable");
    expect(detail.type.name).toBe("Harness");

    const audit = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "gear.added"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorUserId).toBe(actorId);
    const meta = JSON.parse(audit[0]?.metadataJson ?? "{}") as Record<
      string,
      unknown
    >;
    expect(meta.code).toBe("CH93");
  });

  it("rejects duplicate active codes", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    await createGearOk({ typePublicId, code: "CH1" });
    const dup = await createGearAction({
      typePublicId,
      code: "CH1",
      description: null,
      acquiredAt: null,
      acquisitionCostCents: null,
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [],
    });
    expect(dup).toEqual({ ok: false, reason: "code_in_use", code: "CH1" });
  });

  it("retiring NULLs the code and captures priorCode in audit metadata", async () => {
    const actorId = await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const publicId = await createGearOk({ typePublicId, code: "CH93" });

    const retired = await retireGearAction({
      publicId,
      reason: "snapped buckle",
    });
    expect(retired.ok).toBe(true);

    const detail = await getGearDetailAction({ publicId });
    expect(detail.code).toBeNull();
    expect(detail.lifecycle).toBe("retired");
    expect(detail.retiredReason).toBe("snapped buckle");

    const audit = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "gear.retired"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorUserId).toBe(actorId);
    const meta = JSON.parse(audit[0]?.metadataJson ?? "{}") as Record<
      string,
      unknown
    >;
    expect(meta.priorCode).toBe("CH93");
    expect(meta.reason).toBe("snapped buckle");
  });

  it("frees the code for reuse after retirement", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const first = await createGearOk({ typePublicId, code: "CH93" });
    await retireGearAction({ publicId: first, reason: null });

    // Reissue CH93 on a fresh piece.
    const reissued = await createGearOk({ typePublicId, code: "CH93" });
    const detail = await getGearDetailAction({ publicId: reissued });
    expect(detail.code).toBe("CH93");
    expect(detail.lifecycle).toBe("active");
  });

  it("unretires a previously retired piece", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const publicId = await createGearOk({ typePublicId, code: "CH1" });
    await retireGearAction({ publicId, reason: null });
    const result = await unretireGearAction({ publicId });
    expect(result.ok).toBe(true);
    const detail = await getGearDetailAction({ publicId });
    expect(detail.lifecycle).toBe("active");
    expect(detail.retiredReason).toBeNull();
  });

  it("edit-rename of code emits gear.updated with priorCode", async () => {
    const actorId = await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const publicId = await createGearOk({ typePublicId, code: "CH1" });

    const result = await editGearAction({
      publicId,
      typePublicId,
      code: "CH2",
      description: null,
      acquiredAt: null,
      acquisitionCostCents: null,
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [],
    });
    expect(result.ok).toBe(true);

    const audit = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "gear.updated"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorUserId).toBe(actorId);
    const meta = JSON.parse(audit[0]?.metadataJson ?? "{}") as Record<
      string,
      unknown
    >;
    expect(meta.priorCode).toBe("CH1");
    expect(meta.code).toBe("CH2");
    expect((meta.changedFields as string[]).includes("code")).toBe(true);
  });
});

// ── tag management + filtering ─────────────────────────────────────────

describe("tags + list filters", () => {
  it("creates a tag with normalized name and assigns it on edit", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const gearPublicId = await createGearOk({ typePublicId, code: "CH1" });

    const tagResult = await createGearTagAction({ name: "  Outdoor Use  " });
    expect(tagResult.ok).toBe(true);
    if (!tagResult.ok) return;
    expect(tagResult.name).toBe("outdoor-use");

    await editGearAction({
      publicId: gearPublicId,
      typePublicId,
      code: "CH1",
      description: null,
      acquiredAt: null,
      acquisitionCostCents: null,
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [tagResult.publicId],
    });

    const detail = await getGearDetailAction({ publicId: gearPublicId });
    expect(detail.tags).toHaveLength(1);
    expect(detail.tags[0]?.name).toBe("outdoor-use");
  });

  it("createGearAction attaches tags that survive list + detail reads", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const tagPublicId = await createTagOk("outdoor");
    const gearPublicId = await createGearOk({
      typePublicId,
      code: "CH1",
      tagPublicIds: [tagPublicId],
    });

    const list = await listGearAction({});
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]?.tags).toHaveLength(1);
    expect(list.rows[0]?.tags[0]?.name).toBe("outdoor");

    const detail = await getGearDetailAction({ publicId: gearPublicId });
    expect(detail.tags).toHaveLength(1);
    expect(detail.tags[0]?.name).toBe("outdoor");
  });

  it("filters by tag (AND across multiple)", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const outdoor = await createTagOk("outdoor");
    const winter = await createTagOk("winter");
    const a = await createGearOk({
      typePublicId,
      code: "CH1",
      tagPublicIds: [outdoor],
    });
    const b = await createGearOk({
      typePublicId,
      code: "CH2",
      tagPublicIds: [outdoor, winter],
    });
    await createGearOk({
      typePublicId,
      code: "CH3",
      tagPublicIds: [winter],
    });

    const both = await listGearAction({ tagPublicIds: [outdoor, winter] });
    expect(both.rows.map((r) => r.publicId)).toEqual([b]);

    const justOutdoor = await listGearAction({ tagPublicIds: [outdoor] });
    expect(new Set(justOutdoor.rows.map((r) => r.publicId))).toEqual(
      new Set([a, b]),
    );
  });

  it("returns empty when tag publicId doesn't resolve", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    await createGearOk({ typePublicId, code: "CH1" });
    const result = await listGearAction({ tagPublicIds: ["nope-not-a-tag"] });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("filters by lifecycle and condition independently", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const active = await createGearOk({
      typePublicId,
      code: "CH1",
      condition: "needs_repair",
    });
    const retired = await createGearOk({ typePublicId, code: "CH2" });
    await retireGearAction({ publicId: retired, reason: null });

    const activeOnly = await listGearAction({ lifecycle: "active" });
    expect(activeOnly.rows.map((r) => r.publicId)).toEqual([active]);

    const broken = await listGearAction({ condition: "needs_repair" });
    expect(broken.rows.map((r) => r.publicId)).toEqual([active]);
  });

  it("searches across code, description, and notes", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    await createGearOk({
      typePublicId,
      code: "CH1",
      description: "Black Diamond Momentum",
    });
    await createGearOk({
      typePublicId,
      code: "CH2",
      description: "Petzl Sama",
    });
    await listGearTagsAction(); // sanity touch

    const result = await listGearAction({ q: "petzl" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.code).toBe("CH2");
  });
});

// ── suggest code ───────────────────────────────────────────────────────

describe("suggestCodeForType", () => {
  it("returns prefix+1 when no gear exists yet", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const { suggestion } = await suggestCodeForTypeAction({ typePublicId });
    expect(suggestion).toBe("CH1");
  });

  it("returns max-suffix + 1 across existing active codes", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    await createGearOk({ typePublicId, code: "CH1" });
    await createGearOk({ typePublicId, code: "CH5" });
    await createGearOk({ typePublicId, code: "CH10" });
    const { suggestion } = await suggestCodeForTypeAction({ typePublicId });
    expect(suggestion).toBe("CH11");
  });

  it("ignores non-numeric tails and codes that don't share the prefix", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    await createGearOk({ typePublicId, code: "CH-spare" });
    await createGearOk({ typePublicId, code: "LJ7" });
    await createGearOk({ typePublicId, code: "CH3" });
    const { suggestion } = await suggestCodeForTypeAction({ typePublicId });
    expect(suggestion).toBe("CH4");
  });

  it("returns empty when the type has no prefix configured", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Misc", prefix: null });
    const { suggestion } = await suggestCodeForTypeAction({ typePublicId });
    expect(suggestion).toBe("");
  });

  it("skips retired pieces when computing the next number", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const a = await createGearOk({ typePublicId, code: "CH1" });
    const b = await createGearOk({ typePublicId, code: "CH2" });
    await retireGearAction({ publicId: b, reason: null });
    const { suggestion } = await suggestCodeForTypeAction({ typePublicId });
    expect(suggestion).toBe("CH2");
    // sanity: a is still active so we don't suggest CH1.
    expect(a).toBeTruthy();
  });
});

// ── tag management actions ─────────────────────────────────────────────

describe("gear tag CRUD", () => {
  it("renames a tag and emits gear_tag.updated with priorName", async () => {
    const actorId = await signInAsManager();
    const tagPublicId = await createTagOk("outdoor");

    const result = await editGearTagAction({
      publicId: tagPublicId,
      name: "Outdoor Use",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe("outdoor-use");

    const audit = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "gear_tag.updated"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorUserId).toBe(actorId);
    const meta = JSON.parse(audit[0]?.metadataJson ?? "{}") as Record<
      string,
      unknown
    >;
    expect(meta.priorName).toBe("outdoor");
    expect(meta.name).toBe("outdoor-use");
  });

  it("rejects rename collisions and no-ops on same-name renames", async () => {
    await signInAsManager();
    const a = await createTagOk("outdoor");
    const b = await createTagOk("winter");

    const collision = await editGearTagAction({
      publicId: a,
      name: "winter",
    });
    expect(collision).toEqual({ ok: false, reason: "name_in_use" });

    const noop = await editGearTagAction({
      publicId: b,
      name: "winter",
    });
    expect(noop).toEqual({ ok: true, name: "winter" });
    // No audit row emitted on the no-op path — only one gear_tag.updated
    // would exist if it had fired, and we haven't done any successful
    // rename yet.
    const audit = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "gear_tag.updated"));
    expect(audit).toHaveLength(0);
  });

  it("rejects empty-name renames", async () => {
    await signInAsManager();
    const tag = await createTagOk("outdoor");
    const result = await editGearTagAction({ publicId: tag, name: "   " });
    expect(result).toEqual({ ok: false, reason: "empty" });
  });

  it("delete cascades through gear_tag_assignments", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const tag = await createTagOk("outdoor");
    const gearPublicId = await createGearOk({
      typePublicId,
      code: "CH1",
      tagPublicIds: [tag],
    });

    const result = await deleteGearTagAction({ publicId: tag });
    expect(result.ok).toBe(true);

    const detail = await getGearDetailAction({ publicId: gearPublicId });
    expect(detail.tags).toEqual([]);
  });
});
