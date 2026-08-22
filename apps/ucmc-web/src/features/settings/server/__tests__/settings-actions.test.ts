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
const {
  listSiteSettingsAction,
  getPublicSiteContactAction,
  getPublicFlagsAction,
  listSettingHistoryAction,
} = await import("#/features/settings/server/settings-actions-read.server");
const { readSetting } = await import("#/server/settings/settings-repo.server");
const { SETTINGS } = await import("#/server/settings/settings-registry");
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

describe("getPublicFlagsAction", () => {
  // Page flags come back as a map keyed by the `pages.*` suffix. Most
  // default ON so a cold DB (no site_settings rows) keeps existing pages
  // reachable — the fail-open contract the sidebar + route guards rely on.
  it("returns page flags at their schema defaults with no auth gate", async () => {
    cookieJar.clear();
    const flags = await getPublicFlagsAction();
    for (const key of [
      "home",
      "gear_cave",
      "scholarships",
      "policies",
      "resources",
      "gallery",
      "gazette",
      "history",
      "members",
      "gear",
      "feedback",
      "my_account",
      "blog",
      "reports",
    ] as const) {
      expect(flags.pages[key]).toBe(true);
    }
    // Announcements is the exception — the feature isn't launched, so it
    // ships default OFF.
    expect(flags.pages.announcements).toBe(false);
  });

  it("reflects an overridden page flag", async () => {
    await signInAsManager();
    await updateSettingAction({ key: "pages.gear_cave", value: false });
    cookieJar.clear();
    const flags = await getPublicFlagsAction();
    expect(flags.pages.gear_cave).toBe(false);
    // Siblings stay ON — one toggle doesn't leak across pages.
    expect(flags.pages.history).toBe(true);
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
      value: "not-an-email",
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

// ── per-setting history ────────────────────────────────────────────────

describe("listSettingHistoryAction", () => {
  it("rejects callers without settings:manage", async () => {
    await signInAsRegularMember();
    await expect(
      listSettingHistoryAction({ key: "contact.clubEmail" }),
    ).rejects.toThrow("Forbidden: missing settings:manage");
  });

  it("returns empty list when no edits have been recorded", async () => {
    await signInAsManager();
    const history = await listSettingHistoryAction({
      key: "contact.clubEmail",
    });
    expect(history).toEqual([]);
  });

  it("returns rows in newest-first order with actor name + boolean value", async () => {
    const actorId = await signInAsManager();
    await getDb().insert(schema.profiles).values({
      userId: actorId,
      fullName: "Test Officer",
      preferredName: "Test",
      phone: "555-0100",
      ucAffiliation: "student",
    });

    // Two edits on a boolean setting → both audit rows carry value.
    await updateSettingAction({ key: "pages.announcements", value: true });
    await updateSettingAction({ key: "pages.announcements", value: false });

    const history = await listSettingHistoryAction({
      key: "pages.announcements",
    });
    expect(history).toHaveLength(2);
    expect(history[0].booleanValue).toBe(false); // newest first
    expect(history[1].booleanValue).toBe(true);
    expect(history[0].actorName).toBe("Test Officer");
    expect(typeof history[0].atMs).toBe("number");
  });

  it("does not expose values for non-boolean settings", async () => {
    await signInAsManager();
    await updateSettingAction({
      key: "contact.clubEmail",
      value: "secret@example.com",
    });
    const history = await listSettingHistoryAction({
      key: "contact.clubEmail",
    });
    expect(history).toHaveLength(1);
    // Non-boolean values are deliberately omitted from audit metadata
    // (see settings-actions.server.ts) so the history view can't leak
    // emails / URLs / freeform JSON.
    expect(history[0].booleanValue).toBeNull();
  });
});

// ── reset-to-default behaves like a regular save ───────────────────────

describe("reset-to-default semantics", () => {
  it("writing the schema default leaves no Custom badge state", async () => {
    await signInAsManager();
    await updateSettingAction({
      key: "contact.clubEmail",
      value: "off-default@example.com",
    });
    // "Reset" is just an update to the default value; the action layer
    // doesn't need a special code path.
    const defaultValue = SETTINGS["contact.clubEmail"].parse(undefined);
    await updateSettingAction({
      key: "contact.clubEmail",
      value: defaultValue,
    });
    const stored = await readSetting("contact.clubEmail");
    expect(stored).toBe(defaultValue);
    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "settings_updated"))
      .all();
    // One row per edit including the reset — it's an audit-worthy event.
    expect(auditRows).toHaveLength(2);
  });
});
