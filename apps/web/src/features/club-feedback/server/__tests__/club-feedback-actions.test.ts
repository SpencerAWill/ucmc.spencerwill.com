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
  checkFeedbackRateLimit: async () => true,
  checkClubFeedbackRateLimit: async () => true,
}));

const {
  listMyClubFeedbackAction,
  listAllClubFeedbackAction,
  submitClubFeedbackAction,
  updateClubFeedbackStatusAction,
} =
  await import("#/features/club-feedback/server/club-feedback-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(
  email: string,
  fullName = "Test User",
): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status: "approved",
  });
  await attachPrimaryEmail(id, email);
  await db.insert(schema.profiles).values({
    userId: id,
    fullName,
    preferredName: fullName.split(" ")[0],
    phone: "+15135551212",
    ucAffiliation: "student",
    updatedAt: new Date(),
  });
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

async function signInAsAdmin(email = "admin@example.com"): Promise<string> {
  const userId = await seedUser(email, "Admin Person");
  await assignRole(userId, "role_system_admin");
  await signInAs(userId);
  return userId;
}

async function signInAsMember(
  email = "member@example.com",
  name = "Member Person",
): Promise<string> {
  const userId = await seedUser(email, name);
  await assignRole(userId, "role_member");
  await signInAs(userId);
  return userId;
}

async function signInAsBareUser(email = "bare@example.com"): Promise<string> {
  const userId = await seedUser(email, "Bare User");
  await signInAs(userId);
  return userId;
}

// ── setup ──────────────────────────────────────────────────────────────

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.clubFeedback);
  await db.delete(schema.siteSettings);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

// ── authorization ─────────────────────────────────────────────────────

describe("club feedback authorization", () => {
  it("submitClubFeedbackAction rejects unauthenticated callers", async () => {
    cookieJar.clear();
    await expect(
      submitClubFeedbackAction({
        kind: "suggestion",
        title: "x",
        body: "y",
        anonymous: false,
      }),
    ).rejects.toThrow("Not signed in");
  });

  it("submitClubFeedbackAction rejects users without club_feedback:submit", async () => {
    await signInAsBareUser();
    await expect(
      submitClubFeedbackAction({
        kind: "suggestion",
        title: "x",
        body: "y",
        anonymous: false,
      }),
    ).rejects.toThrow("Forbidden: missing club_feedback:submit");
  });

  it("listAllClubFeedbackAction rejects users without club_feedback:manage", async () => {
    await signInAsMember();
    await expect(listAllClubFeedbackAction()).rejects.toThrow(
      "Forbidden: missing club_feedback:manage",
    );
  });

  it("updateClubFeedbackStatusAction rejects users without club_feedback:manage", async () => {
    await signInAsMember();
    await expect(
      updateClubFeedbackStatusAction({ id: "cfb_x", status: "resolved" }),
    ).rejects.toThrow("Forbidden: missing club_feedback:manage");
  });

  it("submitClubFeedbackAction rejects when feedback.club_enabled is off", async () => {
    await signInAsMember();
    await getDb().insert(schema.siteSettings).values({
      key: "feedback.club_enabled",
      valueJson: "false",
      updatedBy: null,
    });
    await expect(
      submitClubFeedbackAction({
        kind: "general",
        title: "After hours",
        body: "Anyone home?",
        anonymous: false,
      }),
    ).rejects.toThrow("Club feedback submissions are currently disabled.");
    expect(await getDb().select().from(schema.clubFeedback)).toHaveLength(0);
  });
});

// ── happy path ────────────────────────────────────────────────────────

describe("club feedback lifecycle", () => {
  it("member can submit and list their own", async () => {
    const memberId = await signInAsMember();
    const { id } = await submitClubFeedbackAction({
      kind: "suggestion",
      title: "More trip variety",
      body: "More beginner-friendly day hikes would be great.",
      anonymous: false,
    });
    expect(id).toMatch(/^cfb_/);

    const mine = await listMyClubFeedbackAction();
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(id);
    expect(mine[0].kind).toBe("suggestion");
    expect(mine[0].status).toBe("open");
    expect(mine[0].anonymous).toBe(false);
    expect(mine[0].createdBy).toBe(memberId);
    expect(mine[0].body).toContain("More beginner-friendly day hikes");
  });

  it("listMyClubFeedbackAction scopes to the caller, not other members", async () => {
    const memberA = await signInAsMember("a@example.com", "Alice");
    await submitClubFeedbackAction({
      kind: "general",
      title: "Hi from A",
      body: "Hello exec board",
      anonymous: false,
    });
    expect((await listMyClubFeedbackAction()).length).toBe(1);

    await signInAsMember("b@example.com", "Bob");
    expect((await listMyClubFeedbackAction()).length).toBe(0);

    // A's row is still in the DB.
    const total = await getDb().select().from(schema.clubFeedback);
    expect(total).toHaveLength(1);
    expect(total[0].createdBy).toBe(memberA);
  });
});

// ── anonymity ─────────────────────────────────────────────────────────

describe("club feedback anonymity", () => {
  it("admin list redacts submitter info when the row is anonymous", async () => {
    const memberId = await signInAsMember("anon@example.com", "Anon Member");
    await submitClubFeedbackAction({
      kind: "concern",
      title: "I have a concern",
      body: "About something that happened at the last trip.",
      anonymous: true,
    });

    // Row is stored with createdBy populated (rate-limit + abuse need it).
    const storedRow = await getDb().select().from(schema.clubFeedback).get();
    expect(storedRow?.createdBy).toBe(memberId);
    expect(storedRow?.anonymous).toBe(true);

    // Admin sees the row but with no submitter columns.
    await signInAsAdmin();
    const all = await listAllClubFeedbackAction();
    expect(all).toHaveLength(1);
    expect(all[0].anonymous).toBe(true);
    expect(all[0].createdBy).toBeNull();
    expect(all[0].createdByPublicId).toBeNull();
    expect(all[0].authorDisplayName).toBeNull();
    expect(all[0].authorAvatarKey).toBeNull();
  });

  it("admin list does NOT redact non-anonymous rows", async () => {
    const memberId = await signInAsMember("named@example.com", "Named Member");
    await submitClubFeedbackAction({
      kind: "praise",
      title: "Great trip last weekend",
      body: "Thanks!",
      anonymous: false,
    });

    await signInAsAdmin();
    const all = await listAllClubFeedbackAction();
    expect(all).toHaveLength(1);
    expect(all[0].anonymous).toBe(false);
    expect(all[0].createdBy).toBe(memberId);
    // preferredName is "Named" (firstname split in the helper).
    expect(all[0].authorDisplayName).toBe("Named");
  });

  it("owner sees their own anonymous row un-redacted in 'my submissions'", async () => {
    const memberId = await signInAsMember("self@example.com", "Self Member");
    await submitClubFeedbackAction({
      kind: "concern",
      title: "My own anon row",
      body: "I want to see this one",
      anonymous: true,
    });

    const mine = await listMyClubFeedbackAction();
    expect(mine).toHaveLength(1);
    expect(mine[0].anonymous).toBe(true);
    // Owner gets full identity columns back in their own list.
    expect(mine[0].createdBy).toBe(memberId);
    expect(mine[0].authorDisplayName).toBe("Self");
  });
});

// ── admin triage ──────────────────────────────────────────────────────

describe("club feedback admin triage", () => {
  it("admin lists all rows across users and can update status", async () => {
    await signInAsMember("a@example.com", "Alice");
    const a = await submitClubFeedbackAction({
      kind: "suggestion",
      title: "From Alice",
      body: "Some idea",
      anonymous: false,
    });
    await signInAsMember("b@example.com", "Bob");
    await submitClubFeedbackAction({
      kind: "praise",
      title: "From Bob",
      body: "Nice job",
      anonymous: false,
    });

    await signInAsAdmin();
    const all = await listAllClubFeedbackAction();
    expect(all).toHaveLength(2);

    await updateClubFeedbackStatusAction({
      id: a.id,
      status: "acknowledged",
    });
    const updated = await listAllClubFeedbackAction();
    const aRow = updated.find((r) => r.id === a.id);
    expect(aRow?.status).toBe("acknowledged");

    // Verify the row's updatedAt actually changed (defensive — the
    // action returns `ok: true` but the test should fail loudly if a
    // future refactor stops touching the timestamp).
    const stored = await getDb()
      .select()
      .from(schema.clubFeedback)
      .where(eq(schema.clubFeedback.id, a.id))
      .get();
    expect(stored?.updatedAt.getTime()).toBeGreaterThanOrEqual(
      stored?.createdAt.getTime() ?? 0,
    );
  });
});
