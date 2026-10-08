/**
 * Notification preferences: the registry's defaults, the sparse-row
 * contract, and the one invariant the whole design rests on — a
 * non-suppressible category cannot be switched off, by any route.
 *
 * Mock strategy mirrors `email-actions.test.ts`: cookie jar for session
 * cookies, real D1 via the workers pool.
 */
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

const {
  listMyNotificationPreferencesAction,
  setMyNotificationPreferenceAction,
} = await import("#/features/auth/server/notification-prefs-actions.server");
const { listSuppressedUserIds, shouldNotify, setNotificationPreference } =
  await import("#/server/notifications/notification-prefs-repo.server");
const { NOTIFICATION_CATEGORIES } =
  await import("#/server/notifications/notification-registry");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const publicId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await getDb()
    .insert(schema.users)
    .values({ id, publicId, status: "approved" });
  await attachPrimaryEmail(id, `${id}@example.com`);
  await getDb().insert(schema.profiles).values({
    userId: id,
    fullName: "Test Member",
    preferredName: "Test",
    phone: "555-0100",
    ucAffiliation: "student",
  });
  return id;
}

async function signInAs(userId: string): Promise<void> {
  cookieJar.clear();
  await openSession(userId);
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.userNotificationPreferences);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.userEmails);
  await db.delete(schema.users);
});

// ── tests ──────────────────────────────────────────────────────────────

describe("listMyNotificationPreferencesAction", () => {
  it("refuses an unauthenticated caller", async () => {
    cookieJar.clear();
    await expect(listMyNotificationPreferencesAction()).resolves.toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("returns every registry category, resolved to its default, with no rows stored", async () => {
    const userId = await seedUser();
    await signInAs(userId);

    const result = await listMyNotificationPreferencesAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The whole catalogue, not just the switchable part. A list that
    // omitted the non-suppressible notice would leave a member believing
    // the club has no way to contact them about gear they're holding.
    expect(result.rows.map((r) => r.category).sort()).toEqual(
      Object.keys(NOTIFICATION_CATEGORIES).sort(),
    );
    for (const row of result.rows) {
      expect(row.enabled).toBe(
        row.suppressible
          ? NOTIFICATION_CATEGORIES[row.category].defaultEnabled
          : true,
      );
    }

    // Sparse-row contract: reading resolves against the registry and
    // writes nothing.
    const stored = await getDb()
      .select()
      .from(schema.userNotificationPreferences);
    expect(stored).toHaveLength(0);
  });

  it("carries a reason on every category that can't be switched off", async () => {
    const userId = await seedUser();
    await signInAs(userId);

    const result = await listMyNotificationPreferencesAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The UI renders the reason instead of a working switch, so a
    // non-suppressible category without one is a row that just looks
    // broken.
    for (const row of result.rows) {
      expect(row.alwaysOnReason === null).toBe(row.suppressible);
    }
  });
});

describe("setMyNotificationPreferenceAction", () => {
  it("refuses an unauthenticated caller", async () => {
    cookieJar.clear();
    await expect(
      setMyNotificationPreferenceAction({
        category: "gear.loan_due_soon",
        enabled: false,
      }),
    ).resolves.toEqual({ ok: false, reason: "unauthorized" });
  });

  it("refuses a category that isn't in the registry", async () => {
    const userId = await seedUser();
    await signInAs(userId);

    await expect(
      setMyNotificationPreferenceAction({
        category: "gear.not_a_real_category",
        enabled: false,
      }),
    ).resolves.toEqual({ ok: false, reason: "unknown_category" });
  });

  it("persists an opt-out and reads it back", async () => {
    const userId = await seedUser();
    await signInAs(userId);

    await expect(
      setMyNotificationPreferenceAction({
        category: "gear.loan_due_soon",
        enabled: false,
      }),
    ).resolves.toEqual({ ok: true });

    const result = await listMyNotificationPreferencesAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.rows.find((r) => r.category === "gear.loan_due_soon")?.enabled,
    ).toBe(false);

    // `source` is the record of how the choice was made — these rows are
    // deliberately not audited, so it is the only thing that answers
    // "I never turned that off".
    const stored = await getDb()
      .select()
      .from(schema.userNotificationPreferences);
    expect(stored).toHaveLength(1);
    expect(stored[0].source).toBe("user");
    expect(stored[0].channel).toBe("email");
  });

  it("is idempotent — a second write updates rather than duplicating", async () => {
    const userId = await seedUser();
    await signInAs(userId);

    await setMyNotificationPreferenceAction({
      category: "gear.loan_due_soon",
      enabled: false,
    });
    await setMyNotificationPreferenceAction({
      category: "gear.loan_due_soon",
      enabled: true,
    });

    const stored = await getDb()
      .select()
      .from(schema.userNotificationPreferences);
    // The composite primary key is what makes this an upsert rather than
    // a second row the reads would then have to pick between.
    expect(stored).toHaveLength(1);
    expect(stored[0].enabled).toBe(true);
  });

  it("refuses to switch off a non-suppressible category", async () => {
    const userId = await seedUser();
    await signInAs(userId);

    // Refused, not silently ignored. Accepting a write the senders will
    // never read is how a member ends up certain they opted out of
    // something that keeps arriving.
    await expect(
      setMyNotificationPreferenceAction({
        category: "gear.loan_overdue",
        enabled: false,
      }),
    ).resolves.toEqual({ ok: false, reason: "not_suppressible" });

    const stored = await getDb()
      .select()
      .from(schema.userNotificationPreferences);
    expect(stored).toHaveLength(0);
  });
});

describe("shouldNotify", () => {
  it("honours an explicit opt-out on a suppressible category", async () => {
    const userId = await seedUser();
    await setNotificationPreference({
      userId,
      category: "gear.loan_due_soon",
      channel: "email",
      enabled: false,
      source: "user",
    });

    await expect(
      shouldNotify({
        userId,
        category: "gear.loan_due_soon",
        channel: "email",
      }),
    ).resolves.toBe(false);
  });

  it("falls back to the registry default when no row exists", async () => {
    const userId = await seedUser();

    await expect(
      shouldNotify({
        userId,
        category: "gear.loan_due_soon",
        channel: "email",
      }),
    ).resolves.toBe(
      NOTIFICATION_CATEGORIES["gear.loan_due_soon"].defaultEnabled,
    );
  });

  it("ignores a stored opt-out on a non-suppressible category", async () => {
    const userId = await seedUser();
    // Written through the repo, bypassing the action's refusal — this is
    // the row a bug, a migration or a future unsubscribe link could
    // plant. The sender must still send: `shouldNotify` short-circuits
    // on `suppressible` before it ever reads the table.
    await setNotificationPreference({
      userId,
      category: "gear.loan_overdue",
      channel: "email",
      enabled: false,
      source: "unsubscribe_link",
    });

    await expect(
      shouldNotify({ userId, category: "gear.loan_overdue", channel: "email" }),
    ).resolves.toBe(true);
  });
});

describe("listSuppressedUserIds", () => {
  it("returns only the members who explicitly turned the category off", async () => {
    const optedOut = await seedUser();
    const optedIn = await seedUser();
    const untouched = await seedUser();

    await setNotificationPreference({
      userId: optedOut,
      category: "gear.loan_due_soon",
      channel: "email",
      enabled: false,
      source: "user",
    });
    await setNotificationPreference({
      userId: optedIn,
      category: "gear.loan_due_soon",
      channel: "email",
      enabled: true,
      source: "user",
    });

    const suppressed = await listSuppressedUserIds({
      category: "gear.loan_due_soon",
      channel: "email",
    });

    // An explicit `true` must not land in the suppressed set, and a
    // member with no row at all must not either — the cron subtracts
    // this set from its recipients, so a false positive silently drops
    // somebody's reminder.
    expect(suppressed.has(optedOut)).toBe(true);
    expect(suppressed.has(optedIn)).toBe(false);
    expect(suppressed.has(untouched)).toBe(false);
  });

  it("is scoped to the category asked for", async () => {
    const userId = await seedUser();
    await setNotificationPreference({
      userId,
      category: "gear.loan_due_soon",
      channel: "email",
      enabled: false,
      source: "user",
    });

    await expect(
      listSuppressedUserIds({
        category: "gear.loan_overdue",
        channel: "email",
      }),
    ).resolves.toEqual(new Set());
  });
});
