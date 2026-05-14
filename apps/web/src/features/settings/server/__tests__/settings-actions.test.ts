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

const { updateSettingAction } =
  await import("#/features/settings/server/settings-actions.server");
const { listSiteSettingsAction, getPublicSiteContactAction } =
  await import("#/features/settings/server/settings-actions-read.server");
const { readSetting } =
  await import("#/features/settings/server/settings-repo.server");
const { SETTINGS } =
  await import("#/features/settings/server/settings-registry");
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

async function signInAs(userId: string): Promise<void> {
  cookieJar.clear();
  await openSession(userId);
}

async function signInAsManager(): Promise<string> {
  const userId = await seedUser("admin@example.com");
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

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  // auditLog has SET NULL on actor/target so it survives user deletes
  // — clear it explicitly. site_settings is the unit-under-test.
  await db.delete(schema.auditLog);
  await db.delete(schema.siteSettings);
  await db.delete(schema.profiles);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.users);
});

// ── authorization ──────────────────────────────────────────────────────

describe("authorization", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(
      updateSettingAction({
        key: "contact.clubEmail",
        value: "club@example.com",
      }),
    ).rejects.toThrow("Not signed in");
  });

  it("rejects callers without settings:manage", async () => {
    await signInAsRegularMember();
    await expect(
      updateSettingAction({
        key: "contact.clubEmail",
        value: "club@example.com",
      }),
    ).rejects.toThrow("Forbidden: missing settings:manage");
  });

  it("rejects listSiteSettingsAction without settings:manage", async () => {
    await signInAsRegularMember();
    await expect(listSiteSettingsAction()).rejects.toThrow(
      "Forbidden: missing settings:manage",
    );
  });
});

// ── reads (fail-open) ──────────────────────────────────────────────────

describe("readSetting fail-open", () => {
  it("returns the schema default when no row exists", async () => {
    const value = await readSetting("contact.clubEmail");
    expect(value).toBe(SETTINGS["contact.clubEmail"].parse(undefined));
  });

  it("returns the schema default when the row's JSON is malformed", async () => {
    await getDb()
      .insert(schema.siteSettings)
      .values({ key: "contact.clubEmail", valueJson: "not-json{{{" });
    const value = await readSetting("contact.clubEmail");
    expect(value).toBe(SETTINGS["contact.clubEmail"].parse(undefined));
  });

  it("returns the schema default when the stored value fails validation", async () => {
    await getDb()
      .insert(schema.siteSettings)
      .values({
        key: "contact.clubEmail",
        valueJson: JSON.stringify("not-an-email"),
      });
    const value = await readSetting("contact.clubEmail");
    expect(value).toBe(SETTINGS["contact.clubEmail"].parse(undefined));
  });

  it("returns the stored value when present and valid", async () => {
    await getDb()
      .insert(schema.siteSettings)
      .values({
        key: "contact.clubEmail",
        valueJson: JSON.stringify("custom@example.com"),
      });
    const value = await readSetting("contact.clubEmail");
    expect(value).toBe("custom@example.com");
  });
});

// ── public-read allowlist ──────────────────────────────────────────────

describe("listSiteSettingsAction snapshot shape", () => {
  it("returns null edit metadata for unset keys", async () => {
    await signInAsManager();
    const snapshot = await listSiteSettingsAction();
    expect(snapshot["contact.clubEmail"]).toEqual({
      value: SETTINGS["contact.clubEmail"].parse(undefined),
      updatedAtMs: null,
      updatedByName: null,
    });
  });

  it("returns the actor's profile name + an updatedAtMs after an edit", async () => {
    const actorId = await signInAsManager();
    // Profile join requires a profiles row — seed one.
    await getDb().insert(schema.profiles).values({
      userId: actorId,
      fullName: "Test Officer",
      preferredName: "Test",
      phone: "555-0100",
      ucAffiliation: "student",
    });

    const result = await updateSettingAction({
      key: "contact.clubEmail",
      value: "new@example.com",
    });
    expect(result.ok).toBe(true);

    const snapshot = await listSiteSettingsAction();
    expect(snapshot["contact.clubEmail"].value).toBe("new@example.com");
    expect(snapshot["contact.clubEmail"].updatedByName).toBe("Test Officer");
    expect(typeof snapshot["contact.clubEmail"].updatedAtMs).toBe("number");
  });
});

describe("getPublicSiteContactAction", () => {
  it("returns the curated subset with no auth gate", async () => {
    cookieJar.clear();
    const out = await getPublicSiteContactAction();
    expect(out).toHaveProperty("clubEmail");
    expect(typeof out.clubEmail).toBe("string");
  });
});

// ── update + audit ─────────────────────────────────────────────────────

describe("updateSettingAction", () => {
  it("writes the setting and emits one audit row in the same batch", async () => {
    const actorId = await signInAsManager();
    const result = await updateSettingAction({
      key: "contact.clubEmail",
      value: "new@example.com",
    });
    expect(result).toEqual({ ok: true });

    const stored = await readSetting("contact.clubEmail");
    expect(stored).toBe("new@example.com");

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "settings_updated"))
      .all();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorUserId).toBe(actorId);
    expect(auditRows[0].targetType).toBe("site_setting");
    expect(auditRows[0].targetId).toBe("contact.clubEmail");
    const metadata = auditRows[0].metadataJson
      ? JSON.parse(auditRows[0].metadataJson)
      : null;
    // Non-boolean values: metadata is { key } only (no value, since
    // emails / URLs / freeform JSON are too easy to leak).
    expect(metadata).toEqual({ key: "contact.clubEmail" });
  });

  it("rejects invalid values without writing or auditing", async () => {
    await signInAsManager();
    const result = await updateSettingAction({
      key: "contact.clubEmail",
      value: "not-an-email" as never,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_value" });

    // No row written → read falls back to schema default.
    const stored = await readSetting("contact.clubEmail");
    expect(stored).toBe(SETTINGS["contact.clubEmail"].parse(undefined));
    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "settings_updated"))
      .all();
    expect(auditRows).toHaveLength(0);
  });

  it("rejects unknown keys without writing or auditing", async () => {
    await signInAsManager();
    const result = await updateSettingAction({
      key: "not.a.real.key" as never,
      value: "anything" as never,
    });
    expect(result).toEqual({ ok: false, reason: "unknown_key" });
    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "settings_updated"))
      .all();
    expect(auditRows).toHaveLength(0);
  });
});
