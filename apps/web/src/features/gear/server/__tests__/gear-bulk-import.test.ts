import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

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

const { bulkImportGearAction } =
  await import("#/features/gear/server/gear-bulk-import-actions.server");
const { createGearTypeAction } =
  await import("#/features/gear/server/gear-types-actions.server");
const { createGearAction, getGearDetailAction } =
  await import("#/features/gear/server/gear-actions.server");
const { createGearTagAction } =
  await import("#/features/gear/server/gear-tags-actions.server");
const { openSession } = await import("#/server/auth/session.server");

async function seedManager(): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: "approved",
    });
  await attachPrimaryEmail(id, `mgr-${id}@example.com`);
  await getDb()
    .insert(schema.userRoles)
    .values({ userId: id, roleId: "role_system_admin" })
    .onConflictDoNothing();
  cookieJar.clear();
  await openSession(id);
  return id;
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.gearInspections);
  await db.delete(schema.gearLoans);
  await db.delete(schema.gearTagAssignments);
  await db.delete(schema.gear);
  await db.delete(schema.gearTags);
  await db.delete(schema.gearTypes);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.users);
});

describe("bulkImportGearAction", () => {
  it("creates every row when all inputs are clean", async () => {
    await seedManager();
    const t = await createGearTypeAction({
      name: "Harness",
      prefix: "CH",
      description: "Test gear",
    });
    if (!t.ok) throw new Error("type setup failed");

    const result = await bulkImportGearAction({
      rows: [
        {
          typePublicId: t.publicId,
          code: "CH1",
          description: "Black Diamond",
          acquiredAt: null,
          acquisitionCostCents: 6000,
        },
        {
          typePublicId: t.publicId,
          code: "CH2",
          description: "Test gear",
          acquiredAt: null,
          acquisitionCostCents: null,
        },
        {
          typePublicId: t.publicId,
          code: null,
          description: "Spare — not yet labeled",
          acquiredAt: null,
          acquisitionCostCents: null,
        },
      ],
    });

    expect(result.skipped).toEqual([]);
    expect(result.created).toHaveLength(3);
    expect(result.created.map((r) => r.code).sort()).toEqual([
      "CH1",
      "CH2",
      null,
    ]);
  });

  it("skips rows whose typePublicId doesn't resolve", async () => {
    await seedManager();
    const t = await createGearTypeAction({
      name: "Harness",
      prefix: "CH",
      description: "Test gear",
    });
    if (!t.ok) throw new Error("type setup failed");
    const result = await bulkImportGearAction({
      rows: [
        {
          typePublicId: t.publicId,
          code: "CH1",
          description: "Test gear",
          acquiredAt: null,
          acquisitionCostCents: null,
        },
        {
          typePublicId: "nope-no-type-here",
          code: "X1",
          description: "Test gear",
          acquiredAt: null,
          acquisitionCostCents: null,
        },
      ],
    });

    expect(result.created).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toEqual({
      rowIndex: 1,
      reason: "type_not_found",
      code: "X1",
    });
  });

  it("skips rows colliding with existing codes", async () => {
    await seedManager();
    const t = await createGearTypeAction({
      name: "Harness",
      prefix: "CH",
      description: "Test gear",
    });
    if (!t.ok) throw new Error("type setup failed");
    // Pre-populate CH1 outside the import.
    const preexisting = await createGearAction({
      typePublicId: t.publicId,
      code: "CH1",
      description: "Test gear",
      thumbnailDataUrl: null,
      acquiredAt: null,
      acquisitionCostCents: null,
      notesMarkdown: null,
      condition: "serviceable",
      tagPublicIds: [],
    });
    if (!preexisting.ok) throw new Error("seed failed");

    const result = await bulkImportGearAction({
      rows: [
        {
          typePublicId: t.publicId,
          code: "CH1",
          description: "Test gear",
          acquiredAt: null,
          acquisitionCostCents: null,
        },
        {
          typePublicId: t.publicId,
          code: "CH2",
          description: "Test gear",
          acquiredAt: null,
          acquisitionCostCents: null,
        },
      ],
    });

    expect(result.created.map((r) => r.code)).toEqual(["CH2"]);
    expect(result.skipped).toEqual([
      { rowIndex: 0, reason: "code_in_use", code: "CH1" },
    ]);
  });

  it("writes extended attributes through and assigns named tags", async () => {
    await seedManager();
    const t = await createGearTypeAction({
      name: "Harness",
      prefix: "CH",
      description: "Test gear",
    });
    if (!t.ok) throw new Error("type setup failed");
    const tagRed = await createGearTagAction({
      name: "color:red",
      visibility: "public",
    });
    const tagM = await createGearTagAction({
      name: "size:m",
      visibility: "public",
    });
    if (!tagRed.ok || !tagM.ok) throw new Error("tag setup failed");

    const result = await bulkImportGearAction({
      rows: [
        {
          typePublicId: t.publicId,
          code: "CH1",
          description: "Petzl Sama",
          acquiredAt: null,
          acquisitionCostCents: 0,
          msrpCents: 8495,
          manufacturer: "Petzl",
          serialNumber: "ABC-123",
          conditionGrade: "good",
          // case-insensitive resolve + duplicate tolerated
          tagNames: ["Color:Red", "size:m", "color:red"],
        },
      ],
    });

    expect(result.skipped).toEqual([]);
    expect(result.created).toHaveLength(1);
    const detail = await getGearDetailAction({
      publicId: result.created[0].publicId,
    });
    expect(detail.msrpCents).toBe(8495);
    expect(detail.manufacturer).toBe("Petzl");
    expect(detail.serialNumber).toBe("ABC-123");
    expect(detail.conditionGrade).toBe("good");
    expect(detail.tags.map((tag) => tag.name).sort()).toEqual([
      "color:red",
      "size:m",
    ]);

    // The per-row gear.added audit event carries the assigned tag IDs
    // so a future audit query can find this attachment without
    // walking gear_tag_assignments.
    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "gear.added"));
    expect(auditRows).toHaveLength(1);
    const meta = JSON.parse(auditRows[0]?.metadataJson ?? "{}") as {
      source?: string;
      tagIds?: string[];
    };
    expect(meta.source).toBe("bulk_import");
    expect(meta.tagIds).toBeDefined();
    expect(meta.tagIds).toHaveLength(2);
  });

  it("skips rows whose tags don't exist", async () => {
    await seedManager();
    const t = await createGearTypeAction({
      name: "Harness",
      prefix: "CH",
      description: "Test gear",
    });
    if (!t.ok) throw new Error("type setup failed");
    const tagRed = await createGearTagAction({
      name: "color:red",
      visibility: "public",
    });
    if (!tagRed.ok) throw new Error("tag setup failed");

    const result = await bulkImportGearAction({
      rows: [
        {
          typePublicId: t.publicId,
          code: "CH1",
          description: "Test gear",
          acquiredAt: null,
          acquisitionCostCents: null,
          tagNames: ["color:red", "size:xl"],
        },
        {
          typePublicId: t.publicId,
          code: "CH2",
          description: "Test gear",
          acquiredAt: null,
          acquisitionCostCents: null,
          tagNames: ["color:red"],
        },
      ],
    });

    expect(result.created).toHaveLength(1);
    expect(result.created[0].code).toBe("CH2");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      rowIndex: 0,
      reason: "tag_not_found",
      code: "CH1",
      missingTags: ["size:xl"],
    });
  });

  it("flags duplicate codes within the same import", async () => {
    await seedManager();
    const t = await createGearTypeAction({
      name: "Harness",
      prefix: "CH",
      description: "Test gear",
    });
    if (!t.ok) throw new Error("type setup failed");
    const result = await bulkImportGearAction({
      rows: [
        {
          typePublicId: t.publicId,
          code: "CH1",
          description: "Test gear",
          acquiredAt: null,
          acquisitionCostCents: null,
        },
        {
          typePublicId: t.publicId,
          code: "CH1",
          description: "Test gear",
          acquiredAt: null,
          acquisitionCostCents: null,
        },
      ],
    });

    expect(result.created).toHaveLength(1);
    expect(result.skipped).toEqual([
      { rowIndex: 1, reason: "code_duplicate_in_import", code: "CH1" },
    ]);
  });
});
