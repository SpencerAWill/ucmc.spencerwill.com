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
  checkUploadRateLimit: async () => true,
  checkCalendarFeedRateLimit: async () => true,
}));

const {
  MAX_ACTIVE_SUBSCRIPTIONS,
  createMySubscriptionAction,
  listMySubscriptionsAction,
  revokeMySubscriptionAction,
  rotateMySubscriptionAction,
} = await import("#/features/calendar/server/subscription-actions.server");
const { resolveSubscriptionToken } =
  await import("#/features/calendar/server/feed-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(email: string, status: "approved" | "pending") {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status,
  });
  await attachPrimaryEmail(id, email);
  await db.insert(schema.profiles).values({
    userId: id,
    fullName: "Test User",
    preferredName: "Test",
    phone: "+15135551212",
    ucAffiliation: "student",
    updatedAt: Temporal.Now.instant(),
  });
  return id;
}

async function signIn(
  email: string,
  status: "approved" | "pending" = "approved",
) {
  const userId = await seedUser(email, status);
  await getDb()
    .insert(schema.userRoles)
    .values({ userId, roleId: "role_member" })
    .onConflictDoNothing();
  cookieJar.clear();
  await openSession(userId);
  return userId;
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.calendarSubscriptions);
  await db.delete(schema.auditLog);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

// ── access ─────────────────────────────────────────────────────────────

describe("access", () => {
  it("refuses an anonymous caller", async () => {
    await expect(listMySubscriptionsAction()).rejects.toThrow(/Not signed in/);
    await expect(createMySubscriptionAction({ label: null })).rejects.toThrow(
      /Not signed in/,
    );
  });

  /**
   * A pending registrant has no calendar to subscribe to — their
   * visibility scope is the public tier, which the token-less public
   * feed already serves.
   */
  it("refuses a pending account", async () => {
    await signIn("pending@example.com", "pending");
    await expect(createMySubscriptionAction({ label: null })).rejects.toThrow(
      /not approved/,
    );
  });
});

// ── minting ────────────────────────────────────────────────────────────

describe("createMySubscriptionAction", () => {
  it("mints a working token and records an audit row", async () => {
    const userId = await signIn("mint@example.com");
    const { id, token } = await createMySubscriptionAction({ label: "iPhone" });

    expect(await resolveSubscriptionToken(token)).toBe(userId);

    const audit = await getDb().select().from(schema.auditLog);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("calendar_subscription.created");
    expect(audit[0].actorUserId).toBe(userId);
    expect(audit[0].targetUserId).toBe(userId);
    expect(audit[0].targetId).toBe(id);
  });

  /**
   * The audit viewer renders `target_id` as visible text, so a token
   * there would put a live bearer credential on an officer's screen —
   * and in whatever they screenshot. The row id identifies the
   * subscription just as well.
   */
  it("never puts the token in the audit row", async () => {
    await signIn("audit@example.com");
    const { token } = await createMySubscriptionAction({ label: "iPhone" });

    const audit = await getDb().select().from(schema.auditLog);
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(token);
  });

  it("stops at the active-subscription cap", async () => {
    await signIn("cap@example.com");
    for (let i = 0; i < MAX_ACTIVE_SUBSCRIPTIONS; i += 1) {
      await createMySubscriptionAction({ label: `Device ${i}` });
    }
    await expect(
      createMySubscriptionAction({ label: "One too many" }),
    ).rejects.toThrow(/Revoke one/);
  });

  /**
   * Revoked rows are kept forever so a leaked token can never be
   * reissued — counting them toward the cap would eventually lock a
   * member out of their own calendar.
   */
  it("does not count revoked subscriptions toward the cap", async () => {
    await signIn("cap2@example.com");
    const created = [];
    for (let i = 0; i < MAX_ACTIVE_SUBSCRIPTIONS; i += 1) {
      created.push(await createMySubscriptionAction({ label: `Device ${i}` }));
    }
    await revokeMySubscriptionAction({ id: created[0].id });

    await expect(
      createMySubscriptionAction({ label: "Replacement" }),
    ).resolves.toBeDefined();
  });
});

// ── listing ────────────────────────────────────────────────────────────

describe("listMySubscriptionsAction", () => {
  /**
   * The list feeds a page that server-renders on every visit. Shipping
   * live tokens in that payload would put a bearer credential into
   * browser caches and screenshots for no benefit — a member who loses
   * their link rotates instead.
   */
  it("returns no tokens", async () => {
    await signIn("list@example.com");
    const { token } = await createMySubscriptionAction({ label: "iPhone" });

    const listed = await listMySubscriptionsAction();
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(listed[0].label).toBe("iPhone");
  });

  it("omits revoked subscriptions", async () => {
    await signIn("list2@example.com");
    const { id } = await createMySubscriptionAction({ label: "Old phone" });
    await revokeMySubscriptionAction({ id });
    expect(await listMySubscriptionsAction()).toEqual([]);
  });

  it("shows only the caller's own subscriptions", async () => {
    await signIn("owner@example.com");
    await createMySubscriptionAction({ label: "Mine" });

    await signIn("other@example.com");
    await createMySubscriptionAction({ label: "Theirs" });

    const listed = await listMySubscriptionsAction();
    expect(listed.map((row) => row.label)).toEqual(["Theirs"]);
  });
});

// ── revoke ─────────────────────────────────────────────────────────────

describe("revokeMySubscriptionAction", () => {
  it("kills the token immediately", async () => {
    await signIn("revoke@example.com");
    const { id, token } = await createMySubscriptionAction({ label: null });
    expect(await resolveSubscriptionToken(token)).not.toBeNull();

    await revokeMySubscriptionAction({ id });
    expect(await resolveSubscriptionToken(token)).toBeNull();
  });

  /**
   * Ownership is enforced in the UPDATE's WHERE rather than by loading
   * the row and comparing, so there is no code path — now or after a
   * later refactor — where the check can be skipped.
   */
  it("refuses to revoke someone else's subscription", async () => {
    await signIn("victim@example.com");
    const { id, token } = await createMySubscriptionAction({ label: null });

    await signIn("attacker@example.com");
    await expect(revokeMySubscriptionAction({ id })).rejects.toThrow(
      /not found/,
    );

    // And the victim's token still works.
    expect(await resolveSubscriptionToken(token)).not.toBeNull();
  });

  it("refuses a second revoke of the same subscription", async () => {
    await signIn("double@example.com");
    const { id } = await createMySubscriptionAction({ label: null });
    await revokeMySubscriptionAction({ id });
    await expect(revokeMySubscriptionAction({ id })).rejects.toThrow(
      /not found/,
    );
  });

  /**
   * A revoked row is kept rather than deleted: it is what guarantees
   * the UNIQUE index can never hand the same string out twice.
   */
  it("keeps the row so the token can never be reissued", async () => {
    await signIn("keep@example.com");
    const { id } = await createMySubscriptionAction({ label: null });
    await revokeMySubscriptionAction({ id });

    const rows = await getDb()
      .select()
      .from(schema.calendarSubscriptions)
      .where(eq(schema.calendarSubscriptions.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).not.toBeNull();
  });
});

// ── rotate ─────────────────────────────────────────────────────────────

describe("rotateMySubscriptionAction", () => {
  it("issues a new token and kills the old one", async () => {
    const userId = await signIn("rotate@example.com");
    const before = await createMySubscriptionAction({ label: "iPhone" });

    const after = await rotateMySubscriptionAction({ id: before.id });

    expect(after.token).not.toBe(before.token);
    expect(await resolveSubscriptionToken(before.token)).toBeNull();
    expect(await resolveSubscriptionToken(after.token)).toBe(userId);
  });

  it("carries the label across", async () => {
    await signIn("rotate2@example.com");
    const before = await createMySubscriptionAction({ label: "Work laptop" });
    await rotateMySubscriptionAction({ id: before.id });

    const listed = await listMySubscriptionsAction();
    expect(listed).toHaveLength(1);
    expect(listed[0].label).toBe("Work laptop");
  });

  /**
   * One audit event, not a revoke + create pair: the member performed
   * one action and the log should say what they did.
   */
  it("records a single rotation event", async () => {
    await signIn("rotate3@example.com");
    const before = await createMySubscriptionAction({ label: null });
    await rotateMySubscriptionAction({ id: before.id });

    const audit = await getDb().select().from(schema.auditLog);
    const actions = audit.map((row) => row.action);
    expect(actions).toEqual([
      "calendar_subscription.created",
      "calendar_subscription.rotated",
    ]);
  });

  it("refuses to rotate someone else's subscription", async () => {
    await signIn("victim2@example.com");
    const { id, token } = await createMySubscriptionAction({ label: null });

    await signIn("attacker2@example.com");
    await expect(rotateMySubscriptionAction({ id })).rejects.toThrow(
      /not found/,
    );
    expect(await resolveSubscriptionToken(token)).not.toBeNull();
  });
});
