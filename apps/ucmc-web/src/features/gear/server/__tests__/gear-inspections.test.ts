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
const { listGearInspectionsAction, recordGearInspectionAction } =
  await import("#/features/gear/server/gear-inspections-actions.server");
const { openSession } = await import("#/server/auth/session.server");
const { createGearModelAction } =
  await import("#/features/gear/server/models-actions.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(email: string, fullName?: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: "approved",
    });
  await attachPrimaryEmail(id, email);
  if (fullName) {
    await getDb().insert(schema.profiles).values({
      userId: id,
      fullName,
      preferredName: fullName,
      phone: "555-0100",
      ucAffiliation: "student",
    });
  }
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

async function signInAsManager(fullName = "Sam Manager"): Promise<string> {
  const userId = await seedUser(
    `manager-${crypto.randomUUID()}@example.com`,
    fullName,
  );
  await assignRole(userId, "role_system_admin");
  await signInAs(userId);
  return userId;
}

async function signInAsRegularMember(): Promise<string> {
  const userId = await seedUser(
    `plain-${crypto.randomUUID()}@example.com`,
    "Reg Member",
  );
  await assignRole(userId, "role_member");
  await signInAs(userId);
  return userId;
}

/**
 * A member holding `gear:inspect` and NOT `gear:manage` — the delegable
 * inspector tier migration 0064 added. Ad-hoc role so the test pins the
 * permission rather than a seeded role's evolving grants.
 */
async function signInAsInspector(fullName = "Ivy Inspector"): Promise<string> {
  const db = getDb();
  await db
    .insert(schema.roles)
    .values({
      id: "role_test_gear_inspector",
      name: "test_gear_inspector",
      displayName: "Test gear inspector",
    })
    .onConflictDoNothing();
  await db
    .insert(schema.rolePermissions)
    .values({
      roleId: "role_test_gear_inspector",
      permissionId: "perm_gear_inspect",
    })
    .onConflictDoNothing();
  // gear:read is what the list-side gate wants; the inspector role
  // gets it from role_member, which every member holds anyway.
  const userId = await seedUser(
    `inspector-${crypto.randomUUID()}@example.com`,
    fullName,
  );
  await assignRole(userId, "role_member");
  await assignRole(userId, "role_test_gear_inspector");
  await signInAs(userId);
  return userId;
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
    description: null,
    tracking: "coded",
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

async function createGearOk(): Promise<string> {
  const typeResult = await createGearTypeAction({
    name: `Harness ${crypto.randomUUID()}`,
    prefix: "CH",
    description: null,
    inspectionIntervalDays: null,
  });
  if (!typeResult.ok) throw new Error("createGearType failed");
  const gearResult = await createGearAction({
    modelPublicId: await modelForType(typeResult.publicId),
    code: "CH1",
    thumbnailDataUrl: null,
    acquiredAt: null,
    acquisitionCostCents: null,
    notesMarkdown: null,
    condition: "serviceable",
    tagPublicIds: [],
  });
  if (!gearResult.ok) throw new Error("createGear failed");
  return gearResult.publicId;
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
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

// ── authorization ──────────────────────────────────────────────────────

describe("authorization", () => {
  it("rejects unauthenticated callers from listing", async () => {
    cookieJar.clear();
    await expect(
      listGearInspectionsAction({ gearPublicId: "nope" }),
    ).rejects.toThrow("Not signed in");
  });

  it("rejects regular members from recording inspections", async () => {
    await signInAsManager();
    const gearPublicId = await createGearOk();

    await signInAsRegularMember();
    await expect(
      recordGearInspectionAction({
        gearPublicId,
        inspectedAt: Date.now(),
        result: "pass",
        notes: null,
      }),
    ).rejects.toThrow("Forbidden: missing gear:inspect");
  });

  it("lets a gear:inspect holder record an inspection without gear:manage", async () => {
    await signInAsManager();
    const gearPublicId = await createGearOk();

    const inspectorId = await signInAsInspector();
    const result = await recordGearInspectionAction({
      gearPublicId,
      inspectedAt: Date.now(),
      result: "fail",
      notes: "Sheath core-shot at 3m.",
    });
    expect(result.ok).toBe(true);

    // The inspection landed and snapshotted the inspector's name.
    const rows = await listGearInspectionsAction({ gearPublicId });
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toBe("fail");
    expect(rows[0].inspectorName).toBe("Ivy Inspector");
    expect(inspectorId).toBeTruthy();
  });

  it("lets regular members read the inspection log", async () => {
    await signInAsManager();
    const gearPublicId = await createGearOk();
    await recordGearInspectionAction({
      gearPublicId,
      inspectedAt: Date.now(),
      result: "pass",
      notes: "All good.",
    });

    await signInAsRegularMember();
    const rows = await listGearInspectionsAction({ gearPublicId });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.result).toBe("pass");
  });
});

// ── happy path ─────────────────────────────────────────────────────────

describe("recordGearInspectionAction", () => {
  it("records an inspection and emits a gear_inspection.recorded audit row", async () => {
    const managerId = await signInAsManager("Inspector Pat");
    const gearPublicId = await createGearOk();

    const inspectedAt = Date.UTC(2026, 4, 1, 14);
    const result = await recordGearInspectionAction({
      gearPublicId,
      inspectedAt,
      result: "fail",
      notes: "Buckle stress fracture, do not use.",
    });
    expect(result.ok).toBe(true);

    const inspections = await listGearInspectionsAction({ gearPublicId });
    expect(inspections).toHaveLength(1);
    expect(inspections[0]).toMatchObject({
      result: "fail",
      notes: "Buckle stress fracture, do not use.",
      inspectorName: "Inspector Pat",
    });
    expect(inspections[0]?.inspectedAt.epochMilliseconds).toBe(inspectedAt);

    const auditRows = await getDb().select().from(schema.auditLog);
    const inspectionAudit = auditRows.find(
      (r) => r.action === "gear_inspection.recorded",
    );
    expect(inspectionAudit).toBeDefined();
    expect(inspectionAudit?.actorUserId).toBe(managerId);
    const metadata = inspectionAudit?.metadataJson
      ? (JSON.parse(inspectionAudit.metadataJson) as Record<string, unknown>)
      : {};
    expect(metadata.result).toBe("fail");
    expect(metadata.inspectedAt).toBe(inspectedAt);
  });

  it("returns inspections in reverse chronological order", async () => {
    await signInAsManager();
    const gearPublicId = await createGearOk();

    const t0 = Date.UTC(2026, 0, 1);
    const t1 = Date.UTC(2026, 2, 15);
    const t2 = Date.UTC(2026, 4, 9);

    // Insert out-of-order on purpose to prove ORDER BY does the work.
    await recordGearInspectionAction({
      gearPublicId,
      inspectedAt: t1,
      result: "pass",
      notes: null,
    });
    await recordGearInspectionAction({
      gearPublicId,
      inspectedAt: t0,
      result: "advisory",
      notes: null,
    });
    await recordGearInspectionAction({
      gearPublicId,
      inspectedAt: t2,
      result: "pass",
      notes: null,
    });

    const rows = await listGearInspectionsAction({ gearPublicId });
    expect(rows.map((r) => r.inspectedAt.epochMilliseconds)).toEqual([
      t2,
      t1,
      t0,
    ]);
  });

  it("snapshots inspector name and falls back if the user is later deleted", async () => {
    const managerId = await signInAsManager("Pat Snapshot");
    const gearPublicId = await createGearOk();
    await recordGearInspectionAction({
      gearPublicId,
      inspectedAt: Date.now(),
      result: "pass",
      notes: null,
    });

    // Sanity: with profile present, the display name comes from the live
    // profile join.
    const before = await listGearInspectionsAction({ gearPublicId });
    expect(before[0]?.inspectorName).toBe("Pat Snapshot");

    // Drop the profile only. The FK SET NULL leaves the inspection row
    // intact; the display name should fall back to the snapshot.
    const db = getDb();
    await db
      .delete(schema.profiles)
      .where(eq(schema.profiles.userId, managerId));
    // Re-sign-in as someone else so we don't rely on the stale session.
    await signInAsManager();
    const after = await listGearInspectionsAction({ gearPublicId });
    expect(after[0]?.inspectorName).toBe("Pat Snapshot");
  });

  it("throws when the gear publicId is unknown", async () => {
    await signInAsManager();
    await expect(
      recordGearInspectionAction({
        gearPublicId: "does-not-exist",
        inspectedAt: Date.now(),
        result: "pass",
        notes: null,
      }),
    ).rejects.toThrow("Gear not found");
  });
});

describe("counted models are inspected as a batch", () => {
  async function createCountedModel(): Promise<string> {
    const typeResult = await createGearTypeAction({
      name: `Quickdraw ${crypto.randomUUID()}`,
      prefix: "QD",
      description: null,
      inspectionIntervalDays: 365,
    });
    if (!typeResult.ok) throw new Error("createGearType failed");
    const result = await createGearModelAction({
      typePublicId: typeResult.publicId,
      name: `HotWire ${crypto.randomUUID()}`,
      manufacturer: "Black Diamond",
      description: null,
      tracking: "counted",
      msrpCents: null,
      serviceLifeYears: null,
      inspectionIntervalDays: null,
      productUrl: null,
    });
    if (!result.ok) throw new Error("createGearModel failed");
    return result.publicId;
  }

  it("records against the model, which had no way to be inspected at all", async () => {
    await signInAsManager();
    const modelPublicId = await createCountedModel();

    // A counted model has no item rows, so before this the whole
    // category — draws, slings, the shortest-lived soft goods in the
    // cave — had no inspection record available to it.
    const result = await recordGearInspectionAction({
      modelPublicId,
      inspectedAt: Date.now(),
      result: "advisory",
      notes: "Four slings fuzzing at the bar-tack.",
    });
    expect(result).toMatchObject({ ok: true });

    const rows = await listGearInspectionsAction({ modelPublicId });
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toBe("advisory");
    expect(rows[0].notes).toBe("Four slings fuzzing at the bar-tack.");
  });

  it("hangs the row off model_id, leaving item_id null", async () => {
    await signInAsManager();
    const modelPublicId = await createCountedModel();
    await recordGearInspectionAction({
      modelPublicId,
      inspectedAt: Date.now(),
      result: "pass",
      notes: null,
    });

    const rows = await getDb()
      .select({
        itemId: schema.gearInspections.itemId,
        modelId: schema.gearInspections.modelId,
      })
      .from(schema.gearInspections);
    expect(rows).toHaveLength(1);
    expect(rows[0].itemId).toBeNull();
    expect(rows[0].modelId).not.toBeNull();
  });

  it("refuses a coded model, whose units are inspected one at a time", async () => {
    await signInAsManager();
    const gearPublicId = await createGearOk();
    const gear = await getDb()
      .select({ modelId: schema.gearItems.modelId })
      .from(schema.gearItems);
    const models = await getDb()
      .select({
        id: schema.gearModels.id,
        publicId: schema.gearModels.publicId,
      })
      .from(schema.gearModels);
    const modelPublicId =
      models.find((m) => m.id === gear[0]?.modelId)?.publicId ?? "";

    expect(
      await recordGearInspectionAction({
        modelPublicId,
        inspectedAt: Date.now(),
        result: "pass",
        notes: null,
      }),
    ).toEqual({ ok: false, reason: "not_counted" });

    // The read answers empty rather than refusing: a coded model has no
    // batch history, which is a fact about it, not a broken request.
    expect(await listGearInspectionsAction({ modelPublicId })).toEqual([]);
    // …and the piece's own log is untouched by the refused write.
    expect(await listGearInspectionsAction({ gearPublicId })).toEqual([]);
  });

  it("keeps a model's batch log separate from its type's pieces", async () => {
    await signInAsManager();
    const modelPublicId = await createCountedModel();
    const gearPublicId = await createGearOk();
    await recordGearInspectionAction({
      modelPublicId,
      inspectedAt: Date.now(),
      result: "pass",
      notes: "Batch.",
    });
    await recordGearInspectionAction({
      gearPublicId,
      inspectedAt: Date.now(),
      result: "fail",
      notes: "One harness.",
    });

    expect(
      (await listGearInspectionsAction({ modelPublicId })).map((r) => r.notes),
    ).toEqual(["Batch."]);
    expect(
      (await listGearInspectionsAction({ gearPublicId })).map((r) => r.notes),
    ).toEqual(["One harness."]);
  });

  it("records which layer was inspected in the audit row", async () => {
    await signInAsManager();
    const modelPublicId = await createCountedModel();
    await getDb().delete(schema.auditLog);
    await recordGearInspectionAction({
      modelPublicId,
      inspectedAt: Date.now(),
      result: "pass",
      notes: null,
    });

    const rows = await getDb()
      .select({ metadataJson: schema.auditLog.metadataJson })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "gear_inspection.recorded"));
    // Without it, a reader of the log can't tell a batch check of forty
    // draws from one harness.
    expect(JSON.parse(rows[0]?.metadataJson ?? "{}").level).toBe("model");
  });
});
