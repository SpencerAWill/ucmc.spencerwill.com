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

// ── legacy key fallback (temporary, see settings-repo.server.ts) ───────

describe("pre-0064 setting keys", () => {
  it("reads feedback.site_enabled through to the old key when only it exists", async () => {
    // The skew this covers: a build that asks for the new key against a
    // database that hasn't run 0064. Without the fallback the read would
    // miss and fail open to the registry default (true), silently
    // reopening an intake an admin had paused.
    await getDb()
      .insert(schema.siteSettings)
      .values({
        key: "feedback.website_enabled",
        valueJson: JSON.stringify(false),
      });

    expect(await readSetting("feedback.site_enabled")).toBe(false);
  });

  it("prefers the current key when both rows exist", async () => {
    await getDb()
      .insert(schema.siteSettings)
      .values([
        {
          key: "feedback.website_enabled",
          valueJson: JSON.stringify(false),
        },
        { key: "feedback.site_enabled", valueJson: JSON.stringify(true) },
      ]);

    expect(await readSetting("feedback.site_enabled")).toBe(true);
  });

  it("surfaces the old key's value in the /settings snapshot too", async () => {
    // Otherwise the admin panel would render the toggle as ON while the
    // stored pause is still in force — no signal that they disagree.
    await signInAsManager();
    await getDb()
      .insert(schema.siteSettings)
      .values({
        key: "feedback.website_enabled",
        valueJson: JSON.stringify(false),
      });

    const entries = await listSiteSettingsAction();

    expect(entries["feedback.site_enabled"].value).toBe(false);
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
    // Every field the footer and the landing "Where to find us" card
    // read. A missing key here renders as a dropped icon rather than a
    // crash, so it wouldn't fail loudly anywhere else.
    expect(out).toEqual({
      clubEmail: SETTINGS["contact.clubEmail"].parse(undefined),
      instagramUrl: SETTINGS["contact.instagramUrl"].parse(undefined),
      facebookUrl: SETTINGS["contact.facebookUrl"].parse(undefined),
      youtubeUrl: SETTINGS["contact.youtubeUrl"].parse(undefined),
    });
  });

  it("reflects an edited social URL", async () => {
    await signInAsManager();
    await updateSettingAction({
      key: "contact.instagramUrl",
      value: "https://instagram.com/somewhere_else",
    });
    cookieJar.clear();
    const out = await getPublicSiteContactAction();
    expect(out.instagramUrl).toBe("https://instagram.com/somewhere_else");
  });

  it("keeps a blank social URL blank rather than falling back to the default", async () => {
    // Blank is a real value — "the club has no such account" — and both
    // surfaces drop the icon for it. If the fail-open read treated "" as
    // absent, clearing a link would silently restore the seeded URL.
    await signInAsManager();
    await updateSettingAction({
      key: "contact.facebookUrl",
      value: "",
    });
    cookieJar.clear();
    const out = await getPublicSiteContactAction();
    expect(out.facebookUrl).toBe("");
  });

  it("rejects a social URL without an https:// scheme", async () => {
    // A bare "instagram.com/..." in an href resolves as a same-origin
    // relative path, so the scheme check is load-bearing, not cosmetic.
    await signInAsManager();
    const result = await updateSettingAction({
      key: "contact.instagramUrl",
      value: "instagram.com/uc_mountaineering",
    });
    expect(result).toEqual({ ok: false, reason: "invalid_value" });
    // And the rejection left the stored value alone rather than writing
    // a partially-validated one.
    expect(await readSetting("contact.instagramUrl")).toBe(
      SETTINGS["contact.instagramUrl"].parse(undefined),
    );
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
      "gear_cave",
      "scholarships",
      "policies",
      "resources",
      "album",
      "trips",
      "elections",
      "executive",
      "gazette",
      "history",
      "members",
      "members_approved",
      "gear",
      "gear_inventory",
      "feedback",
      "feedback_site",
      "my",
      "my_profile",
      "blog",
      "reports",
    ] as const) {
      expect(flags.pages[key]).toBe(true);
    }
    // Announcements is the exception — the feature isn't launched, so it
    // ships default OFF.
    // Announcements is a FEATURE flag, not a page flag — it also gates
    // the header bell and the server write actions, so it sits at the
    // top level of the snapshot rather than in the pages map.
    expect(flags.announcements).toBe(false);
  });

  it("cascades a section switch to its children in the public snapshot", async () => {
    // The whole point of doing the cascade in the read action: the sidebar,
    // the tab bars, and every route guard consume this map, so they all get
    // the sectioned answer without asking about parents themselves.
    await signInAsManager();
    await updateSettingAction({ key: "pages.gear", value: false });
    cookieJar.clear();
    const flags = await getPublicFlagsAction();
    expect(flags.pages.gear).toBe(false);
    expect(flags.pages.gear_inventory).toBe(false);
    expect(flags.pages.gear_loans).toBe(false);
    // Two levels down — /gear/loans/$id sits under the loans desk.
    expect(flags.pages.gear_loans_detail).toBe(false);
    // The public Gear Cave is a separate root page, NOT part of /gear.
    expect(flags.pages.gear_cave).toBe(true);
  });

  it("leaves a child's stored value intact when its section is off", async () => {
    // /settings edits raw values; only the public snapshot cascades. If the
    // cascade leaked into storage, switching the section back on would come
    // back with the child silently off.
    await signInAsManager();
    await updateSettingAction({ key: "pages.my", value: false });
    const raw = await readSetting("pages.my_profile");
    expect(raw).toBe(true);
    cookieJar.clear();
    expect((await getPublicFlagsAction()).pages.my_profile).toBe(false);
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
    await updateSettingAction({ key: "features.announcements", value: true });
    await updateSettingAction({ key: "features.announcements", value: false });

    const history = await listSettingHistoryAction({
      key: "features.announcements",
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
