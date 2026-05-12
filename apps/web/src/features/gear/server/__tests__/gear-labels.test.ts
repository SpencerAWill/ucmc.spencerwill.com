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

const { createGearAction, listGearLabelsAction, retireGearAction } =
  await import("#/features/gear/server/gear-actions.server");
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
  description?: string;
}): Promise<string> {
  const r = await createGearAction({
    typePublicId: input.typePublicId,
    code: input.code,
    description: input.description ?? "Test gear",
    thumbnailDataUrl: null,
    acquiredAt: null,
    acquisitionCostCents: null,
    notesMarkdown: null,
    condition: "serviceable",
    tagPublicIds: [],
  });
  if (!r.ok) throw new Error(`createGear failed: ${JSON.stringify(r)}`);
  return r.publicId;
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

describe("listGearLabelsAction", () => {
  it("rejects unauthenticated callers", async () => {
    cookieJar.clear();
    await expect(listGearLabelsAction({ publicIds: ["nope"] })).rejects.toThrow(
      "Not signed in",
    );
  });

  it("rejects regular members (officer-only)", async () => {
    await signInAsRegularMember();
    await expect(listGearLabelsAction({ publicIds: ["nope"] })).rejects.toThrow(
      "Forbidden: missing gear:manage",
    );
  });

  it("returns labels in the order of the supplied publicIds", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });
    const b = await createGearOk({ typePublicId, code: "CH2" });
    const c = await createGearOk({ typePublicId, code: "CH3" });

    const labels = await listGearLabelsAction({ publicIds: [c, a, b] });
    expect(labels.map((l) => l.code)).toEqual(["CH3", "CH1", "CH2"]);
    expect(labels[0]).toMatchObject({
      code: "CH3",
      typeName: expect.any(String),
    });
  });

  it("skips codeless gear (no scannable label to print)", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk();
    const withCode = await createGearOk({ typePublicId, code: "CH1" });
    const noCode = await createGearOk({ typePublicId, code: null });

    const labels = await listGearLabelsAction({
      publicIds: [withCode, noCode],
    });
    expect(labels.map((l) => l.code)).toEqual(["CH1"]);
  });

  it("skips retired gear (retire NULLs the code)", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk();
    const active = await createGearOk({ typePublicId, code: "CH1" });
    const willRetire = await createGearOk({ typePublicId, code: "CH2" });
    await retireGearAction({ publicId: willRetire, reason: null });

    const labels = await listGearLabelsAction({
      publicIds: [active, willRetire],
    });
    expect(labels.map((l) => l.code)).toEqual(["CH1"]);
  });

  it("silently skips publicIds that don't resolve", async () => {
    await signInAsManager();
    const typePublicId = await createTypeOk();
    const real = await createGearOk({ typePublicId, code: "CH1" });

    const labels = await listGearLabelsAction({
      publicIds: [real, "does-not-exist"],
    });
    expect(labels).toHaveLength(1);
    expect(labels[0]?.code).toBe("CH1");
  });
});
