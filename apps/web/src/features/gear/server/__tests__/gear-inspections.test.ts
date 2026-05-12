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

async function createGearOk(): Promise<string> {
  const typeResult = await createGearTypeAction({
    name: `Harness ${crypto.randomUUID()}`,
    prefix: "CH",
    description: null,
  });
  if (!typeResult.ok) throw new Error("createGearType failed");
  const gearResult = await createGearAction({
    typePublicId: typeResult.publicId,
    code: "CH1",
    description: "Test harness",
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
    ).rejects.toThrow("Forbidden: missing gear:manage");
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
    expect(inspections[0]?.inspectedAt.getTime()).toBe(inspectedAt);

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
    expect(rows.map((r) => r.inspectedAt.getTime())).toEqual([t2, t1, t0]);
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
