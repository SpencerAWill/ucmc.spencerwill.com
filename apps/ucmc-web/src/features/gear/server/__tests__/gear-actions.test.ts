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
  deactivateGearAction,
  releaseGearItemCodeAction,
  suggestCodeForTypeAction,
  reactivateGearAction,
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
const { createGearModelAction } =
  await import("#/features/gear/server/models-actions.server");
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
    inspectionIntervalDays: null,
  });
  if (!result.ok) {
    throw new Error(`createGearType failed: ${result.reason}`);
  }
  return result.publicId;
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
  code?: string | null;
  description?: string;
  tagPublicIds?: string[];
  condition?: schema.GearCondition;
}): Promise<string> {
  const result = await createGearAction({
    modelPublicId: await modelForType(input.typePublicId),
    code: input.code ?? null,
    description: input.description ?? "Test gear",
    thumbnailDataUrl: null,
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

async function createTagOk(
  name: string,
  visibility: "public" | "internal" = "public",
): Promise<string> {
  const result = await createGearTagAction({ name, visibility });
  if (!result.ok) {
    throw new Error(`createGearTag failed: ${JSON.stringify(result)}`);
  }
  return result.publicId;
}

beforeEach(async () => {
  cookieJar.clear();
  modelByType.clear();
  const db = getDb();
  // Order matters: cascade FKs do the rest, but auditLog has SET NULL
  // on actor/target so it survives user deletes and must be cleared
  // explicitly.
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

describe("authorization", () => {
  it("rejects unauthenticated callers on list", async () => {
    cookieJar.clear();
    await expect(listGearAction({})).rejects.toThrow("Not signed in");
  });

  it("rejects regular members on create", async () => {
    await signInAsRegularMember();
    await expect(
      createGearAction({
        modelPublicId: "nope",
        code: null,
        description: "Test gear",
        thumbnailDataUrl: null,
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

  it("serves model attributes through detail, gating cost to officers", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const model = await createGearModelAction({
      typePublicId,
      name: "Sama",
      manufacturer: "Petzl",
      tracking: "coded",
      description: null,
      msrpCents: 7500,
      serviceLifeYears: 10,
      inspectionIntervalDays: null,
      productUrl: null,
    });
    if (!model.ok) throw new Error("model seed failed");
    const created = await createGearAction({
      modelPublicId: model.publicId,
      code: "CH1",
      description: "blue tape on the belay loop",
      thumbnailDataUrl: null,
      acquiredAt: null,
      manufacturedAt: Date.UTC(2019, 5, 1),
      acquisitionCostCents: 6000,
      acquisitionKind: "donated",
      serialNumber: " ABC-123 ",
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [],
    });
    if (!created.ok) throw new Error("seed failed");

    const detail = await getGearDetailAction({ publicId: created.publicId });
    expect(detail.model.name).toBe("Sama");
    expect(detail.model.manufacturer).toBe("Petzl");
    expect(detail.model.msrpCents).toBe(7500);
    expect(detail.model.serviceLifeYears).toBe(10);
    expect(detail.serialNumber).toBe("ABC-123");
    expect(detail.acquisitionKind).toBe("donated");
    // Manufacture date is the clock service life runs from, and it is
    // deliberately distinct from `acquiredAt` (null here).
    expect(detail.manufacturedAt?.epochMilliseconds).toBe(Date.UTC(2019, 5, 1));
    expect(detail.acquiredAt).toBeNull();

    // The product identity is public; money and serials are officer-only.
    await signInAsRegularMember();
    const memberDetail = await getGearDetailAction({
      publicId: created.publicId,
    });
    expect(memberDetail.model.manufacturer).toBe("Petzl");
    expect(memberDetail.model.msrpCents).toBeNull();
    expect(memberDetail.acquisitionCostCents).toBeNull();
    expect(memberDetail.serialNumber).toBeNull();
  });

  it("editGearAction diffs the item attributes and emits gear.updated", async () => {
    const actorId = await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const publicId = await createGearOk({ typePublicId, code: "CH1" });
    const modelPublicId = await modelForType(typePublicId);

    const result = await editGearAction({
      publicId,
      modelPublicId,
      code: "CH1",
      description: "scuffed buckle",
      thumbnailDataUrl: null,
      acquiredAt: null,
      manufacturedAt: Date.UTC(2020, 0, 15),
      acquisitionCostCents: null,
      acquisitionKind: "purchased",
      serialNumber: null,
      notesMarkdown: null,
      condition: "needs_repair",
      tagPublicIds: [],
    });
    expect(result.ok).toBe(true);

    const detail = await getGearDetailAction({ publicId });
    expect(detail.condition).toBe("needs_repair");
    expect(detail.acquisitionKind).toBe("purchased");
    expect(detail.manufacturedAt?.epochMilliseconds).toBe(
      Date.UTC(2020, 0, 15),
    );

    const audit = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "gear.updated"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorUserId).toBe(actorId);
    const meta = JSON.parse(audit[0]?.metadataJson ?? "{}") as {
      changedFields: string[];
    };
    expect(meta.changedFields).toEqual(
      expect.arrayContaining([
        "manufactured_at",
        "acquisition_kind",
        "condition",
        "description",
      ]),
    );
    // serialNumber went from null → null: not a change.
    expect(meta.changedFields).not.toContain("serial_number");
  });

  it("editGearAction preserves serialNumber when the field is omitted", async () => {
    // The form sheet opened from the gear list page passes a
    // GearSummary, which doesn't include `serialNumber`. The submit
    // path omits `serialNumber` in that scenario; this test pins the
    // server contract that an omitted (undefined) field is a no-op,
    // not a clearing edit.
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const created = await createGearAction({
      modelPublicId: await modelForType(typePublicId),
      code: "CH1",
      description: "Test gear",
      thumbnailDataUrl: null,
      acquiredAt: null,
      acquisitionCostCents: null,
      serialNumber: "ABC-123",
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [],
    });
    if (!created.ok) throw new Error("seed failed");

    const result = await editGearAction({
      publicId: created.publicId,
      modelPublicId: await modelForType(typePublicId),
      code: "CH1",
      description: "Renamed",
      thumbnailDataUrl: null,
      acquiredAt: null,
      acquisitionCostCents: null,
      // serialNumber intentionally omitted — simulates list-page edit.
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [],
    });
    expect(result.ok).toBe(true);

    const detail = await getGearDetailAction({ publicId: created.publicId });
    expect(detail.serialNumber).toBe("ABC-123");

    const audit = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "gear.updated"));
    const meta = JSON.parse(audit[0]?.metadataJson ?? "{}") as {
      changedFields: string[];
    };
    expect(meta.changedFields).not.toContain("serial_number");
  });

  it("strips officer-only fields (cost, msrp, serial) for non-manager readers", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const model = await createGearModelAction({
      typePublicId,
      name: "Sama",
      manufacturer: "Petzl",
      tracking: "coded",
      description: null,
      msrpCents: 8495,
      serviceLifeYears: null,
      inspectionIntervalDays: null,
      productUrl: null,
    });
    if (!model.ok) throw new Error("model seed failed");
    // Seed non-null values on every officer-gated field so the strip is
    // observable.
    const created = await createGearAction({
      modelPublicId: model.publicId,
      code: "CH1",
      description: "Test gear",
      thumbnailDataUrl: null,
      acquiredAt: null,
      acquisitionCostCents: 6000,
      serialNumber: "ABC-123",
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [],
    });
    if (!created.ok) throw new Error("seed failed");

    // Manager view: every field is present.
    const managerList = await listGearAction({});
    expect(managerList.rows[0]?.acquisitionCostCents).toBe(6000);
    expect(managerList.rows[0]?.model.msrpCents).toBe(8495);
    expect(managerList.rows[0]?.model.manufacturer).toBe("Petzl");
    const managerDetail = await getGearDetailAction({
      publicId: created.publicId,
    });
    expect(managerDetail.acquisitionCostCents).toBe(6000);
    expect(managerDetail.model.msrpCents).toBe(8495);
    expect(managerDetail.serialNumber).toBe("ABC-123");

    // Regular member view: money and serial are null; the product
    // identity stays visible, which is the point of browsing.
    await signInAsRegularMember();
    const memberList = await listGearAction({});
    expect(memberList.rows[0]?.acquisitionCostCents).toBeNull();
    expect(memberList.rows[0]?.model.msrpCents).toBeNull();
    expect(memberList.rows[0]?.model.manufacturer).toBe("Petzl");
    const memberDetail = await getGearDetailAction({
      publicId: created.publicId,
    });
    expect(memberDetail.acquisitionCostCents).toBeNull();
    expect(memberDetail.model.msrpCents).toBeNull();
    expect(memberDetail.serialNumber).toBeNull();
    expect(memberDetail.model.manufacturer).toBe("Petzl");
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
      inspectionIntervalDays: null,
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
      inspectionIntervalDays: null,
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
    expect(detail.status).toBe("active");
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

  it("rolls back the R2 thumbnail when createGear fails on code_in_use", async () => {
    // A 1×1 PNG, ~70 bytes, comfortably under the 600 KB wire cap and
    // the 400 KB R2 cap. Any decodable image works; the test asserts
    // R2 state, not pixels.
    const thumbnailDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });

    const first = await createGearAction({
      modelPublicId: await modelForType(typePublicId),
      code: "CH7",
      description: "Test gear",
      thumbnailDataUrl,
      acquiredAt: null,
      acquisitionCostCents: null,
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [],
    });
    if (!first.ok) throw new Error("first create unexpectedly failed");

    // Snapshot R2 state before the failing create so we can assert
    // nothing extra landed.
    const { getPublicBucket } = await import("#/server/r2");
    const before = await getPublicBucket().list({ prefix: "gear/" });
    const beforeKeys = before.objects.map((o) => o.key).sort();

    const dup = await createGearAction({
      modelPublicId: await modelForType(typePublicId),
      code: "CH7",
      description: "Different gear, same code",
      thumbnailDataUrl,
      acquiredAt: null,
      acquisitionCostCents: null,
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [],
    });
    expect(dup).toEqual({ ok: false, reason: "code_in_use", code: "CH7" });

    // The failed create uploaded a thumbnail before the insert blew up
    // (its key includes a fresh gear id), so without rollback there
    // would be a new R2 object under `gear/<failedId>/`. After
    // rollback, R2's object list should be unchanged.
    const after = await getPublicBucket().list({ prefix: "gear/" });
    const afterKeys = after.objects.map((o) => o.key).sort();
    expect(afterKeys).toEqual(beforeKeys);
  });

  it("rejects duplicate active codes", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    await createGearOk({ typePublicId, code: "CH1" });
    const dup = await createGearAction({
      modelPublicId: await modelForType(typePublicId),
      code: "CH1",
      description: "Test gear",
      thumbnailDataUrl: null,
      acquiredAt: null,
      acquisitionCostCents: null,
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [],
    });
    expect(dup).toEqual({ ok: false, reason: "code_in_use", code: "CH1" });
  });

  it("deactivating KEEPS the code and records it in audit metadata", async () => {
    const actorId = await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const publicId = await createGearOk({ typePublicId, code: "CH93" });

    const retired = await deactivateGearAction({
      publicId,
      status: "retired",
      reason: "snapped buckle",
    });
    expect(retired.ok).toBe(true);

    const detail = await getGearDetailAction({ publicId });
    // The old behaviour NULLed this to free the string for reuse. Codes
    // are no longer recycled, so "CH93" stays bound to this harness and
    // every historical mention of it resolves to one thing.
    expect(detail.code).toBe("CH93");
    expect(detail.status).toBe("retired");
    expect(detail.deactivatedReason).toBe("snapped buckle");

    const audit = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "gear.deactivated"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorUserId).toBe(actorId);
    const meta = JSON.parse(audit[0]?.metadataJson ?? "{}") as Record<
      string,
      unknown
    >;
    expect(meta.code).toBe("CH93");
    expect(meta.status).toBe("retired");
    expect(meta.reason).toBe("snapped buckle");
  });

  it("refuses to reissue a retired piece's code", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const first = await createGearOk({ typePublicId, code: "CH93" });
    await deactivateGearAction({
      publicId: first,
      status: "retired",
      reason: null,
    });

    // The unique index still holds the retired row's code.
    const reissue = await createGearAction({
      modelPublicId: await modelForType(typePublicId),
      code: "CH93",
      description: null,
      thumbnailDataUrl: null,
      acquiredAt: null,
      acquisitionCostCents: null,
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [],
    });
    expect(reissue).toEqual({
      ok: false,
      reason: "code_in_use",
      code: "CH93",
    });
  });

  it("releases a retired piece's code so it can be reissued", async () => {
    const actorId = await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const first = await createGearOk({ typePublicId, code: "CH93" });

    // Releasing an ACTIVE item is refused — that would silently
    // un-label something still in service.
    expect(await releaseGearItemCodeAction({ publicId: first })).toEqual({
      ok: false,
      reason: "still_active",
    });

    await deactivateGearAction({
      publicId: first,
      status: "retired",
      reason: null,
    });
    expect(await releaseGearItemCodeAction({ publicId: first })).toEqual({
      ok: true,
    });
    expect((await getGearDetailAction({ publicId: first })).code).toBeNull();

    const audit = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "gear.code_released"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorUserId).toBe(actorId);
    expect(
      (JSON.parse(audit[0]?.metadataJson ?? "{}") as { priorCode?: string })
        .priorCode,
    ).toBe("CH93");

    // Now the string is genuinely free.
    const reissued = await createGearOk({ typePublicId, code: "CH93" });
    const detail = await getGearDetailAction({ publicId: reissued });
    expect(detail.code).toBe("CH93");
    expect(detail.status).toBe("active");
  });

  it("unretires a previously retired piece", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const publicId = await createGearOk({ typePublicId, code: "CH1" });
    await deactivateGearAction({ publicId, status: "retired", reason: null });
    const result = await reactivateGearAction({ publicId });
    expect(result.ok).toBe(true);
    const detail = await getGearDetailAction({ publicId });
    expect(detail.status).toBe("active");
    expect(detail.deactivatedAt).toBeNull();
  });

  it("edit-rename of code emits gear.updated with priorCode", async () => {
    const actorId = await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const publicId = await createGearOk({ typePublicId, code: "CH1" });

    const result = await editGearAction({
      publicId,
      modelPublicId: await modelForType(typePublicId),
      code: "CH2",
      description: "Test gear",
      thumbnailDataUrl: null,
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

    const tagResult = await createGearTagAction({
      name: "  Outdoor Use  ",
      visibility: "public",
    });
    expect(tagResult.ok).toBe(true);
    if (!tagResult.ok) return;
    expect(tagResult.name).toBe("outdoor-use");

    await editGearAction({
      publicId: gearPublicId,
      modelPublicId: await modelForType(typePublicId),
      code: "CH1",
      description: "Test gear",
      thumbnailDataUrl: null,
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

  it("editGearAction emits gear.tags_changed with added/removed diff", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const t1 = await createTagOk("outdoor");
    const t2 = await createTagOk("winter");
    const t3 = await createTagOk("indoor");

    // Start with two tags.
    const gearPublicId = await createGearOk({
      typePublicId,
      code: "CH1",
      tagPublicIds: [t1, t2],
    });

    // Resolve to internal tag IDs for the assertions below — the audit
    // metadata carries `id`s, not publicIds.
    const tagRows = await getDb()
      .select({ id: schema.gearTags.id, publicId: schema.gearTags.publicId })
      .from(schema.gearTags);
    const idByPublicId = new Map(tagRows.map((r) => [r.publicId, r.id]));

    // Edit: drop `winter`, add `indoor`. Net diff should be one add + one
    // remove. `outdoor` is unchanged and must not appear in either array.
    await editGearAction({
      publicId: gearPublicId,
      modelPublicId: await modelForType(typePublicId),
      code: "CH1",
      description: "Test gear",
      acquiredAt: null,
      acquisitionCostCents: null,
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [t1, t3],
    });

    const auditRows = await getDb().select().from(schema.auditLog);
    const tagsChanged = auditRows.find((r) => r.action === "gear.tags_changed");
    expect(tagsChanged).toBeDefined();
    const md = tagsChanged?.metadataJson
      ? (JSON.parse(tagsChanged.metadataJson) as {
          added: string[];
          removed: string[];
        })
      : { added: [], removed: [] };
    expect(md.added).toEqual([idByPublicId.get(t3)]);
    expect(md.removed).toEqual([idByPublicId.get(t2)]);
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
    await deactivateGearAction({
      publicId: retired,
      status: "retired",
      reason: null,
    });

    const activeOnly = await listGearAction({ status: "active" });
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

  it("sorts by the requested key in the requested direction", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    await createGearOk({ typePublicId, code: "CH1" });
    await createGearOk({ typePublicId, code: "CH2" });
    await createGearOk({ typePublicId, code: "CH3" });

    const ascending = await listGearAction({ sort: "code" });
    expect(ascending.rows.map((r) => r.code)).toEqual(["CH1", "CH2", "CH3"]);

    const descending = await listGearAction({ sort: "code", dir: "desc" });
    expect(descending.rows.map((r) => r.code)).toEqual(["CH3", "CH2", "CH1"]);
  });

  it("defaults each sort key to its own natural direction", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const older = await createGearOk({ typePublicId, code: "CH2" });
    const newer = await createGearOk({ typePublicId, code: "CH1" });
    // `gear.created_at` defaults to now for every row a test inserts,
    // so the codes are chosen to run *against* the dates: if the date
    // sort were ignored, the code tiebreaker would answer CH1 first.
    const db = getDb();
    await db
      .update(schema.gearItems)
      .set({ createdAt: Temporal.Instant.from("2024-01-01T00:00:00Z") })
      .where(eq(schema.gearItems.publicId, older));
    await db
      .update(schema.gearItems)
      .set({ createdAt: Temporal.Instant.from("2025-06-01T00:00:00Z") })
      .where(eq(schema.gearItems.publicId, newer));

    // `dir` is the caller's now, but leaving it off must not silently
    // flip a date sort to oldest-first just because `asc` is the more
    // obvious global default.
    const byDate = await listGearAction({ sort: "created_at" });
    expect(byDate.rows.map((r) => r.code)).toEqual(["CH1", "CH2"]);

    const oldestFirst = await listGearAction({
      sort: "created_at",
      dir: "asc",
    });
    expect(oldestFirst.rows.map((r) => r.code)).toEqual(["CH2", "CH1"]);
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

  it("counts retired pieces when computing the next number", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const a = await createGearOk({ typePublicId, code: "CH1" });
    const b = await createGearOk({ typePublicId, code: "CH2" });
    await deactivateGearAction({
      publicId: b,
      status: "retired",
      reason: null,
    });
    // Retired codes are NOT skipped. They still hold the unique index,
    // so suggesting CH2 here would hand the officer a code their own
    // save then rejects — the exact bug the old `active`-only filter
    // would have caused once retirement stopped nulling codes.
    const { suggestion } = await suggestCodeForTypeAction({ typePublicId });
    expect(suggestion).toBe("CH3");
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
      visibility: "public",
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
      visibility: "public",
    });
    expect(collision).toEqual({ ok: false, reason: "name_in_use" });

    const noop = await editGearTagAction({
      publicId: b,
      name: "winter",
      visibility: "public",
    });
    expect(noop).toEqual({ ok: true, name: "winter", visibility: "public" });
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
    const result = await editGearTagAction({
      publicId: tag,
      name: "   ",
      visibility: "public",
    });
    expect(result).toEqual({ ok: false, reason: "empty" });
  });

  it("internal tags are hidden from non-manager readers", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk({ name: "Harness", prefix: "CH" });
    const publicTag = await createTagOk("outdoor", "public");
    const internalTag = await createTagOk("needs-inspection", "internal");
    const gearPublicId = await createGearOk({
      typePublicId,
      code: "CH1",
      tagPublicIds: [publicTag, internalTag],
    });

    // Manager: sees both tags on the gear and in the tag listing.
    const managerDetail = await getGearDetailAction({
      publicId: gearPublicId,
    });
    expect(managerDetail.tags.map((t) => t.name).sort()).toEqual([
      "needs-inspection",
      "outdoor",
    ]);
    const managerTags = await listGearTagsAction();
    expect(managerTags.map((t) => t.name).sort()).toEqual([
      "needs-inspection",
      "outdoor",
    ]);

    // Regular member: internal tag is stripped from gear and from the
    // listing.
    await signInAsRegularMember();
    const memberDetail = await getGearDetailAction({
      publicId: gearPublicId,
    });
    expect(memberDetail.tags.map((t) => t.name)).toEqual(["outdoor"]);
    const memberList = await listGearAction({});
    expect(memberList.rows[0]?.tags.map((t) => t.name)).toEqual(["outdoor"]);
    const memberTags = await listGearTagsAction();
    expect(memberTags.map((t) => t.name)).toEqual(["outdoor"]);
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
