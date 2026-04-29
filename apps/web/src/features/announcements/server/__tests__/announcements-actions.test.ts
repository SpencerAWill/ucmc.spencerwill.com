import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

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
  createAnnouncementAction,
  deleteAnnouncementAction,
  getUnreadCountAction,
  listAnnouncementsAction,
  markAnnouncementsReadAction,
  updateAnnouncementAction,
} =
  await import("#/features/announcements/server/announcements-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(email: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    email,
    status: "approved",
  });
  await db.insert(schema.profiles).values({
    userId: id,
    fullName: "Test User",
    preferredName: "Test",
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
  const userId = await seedUser(email);
  await assignRole(userId, "role_system_admin");
  await signInAs(userId);
  return userId;
}

async function signInAsMember(email = "member@example.com"): Promise<string> {
  const userId = await seedUser(email);
  await assignRole(userId, "role_member");
  await signInAs(userId);
  return userId;
}

async function signInAsBareUser(email = "bare@example.com"): Promise<string> {
  const userId = await seedUser(email);
  await signInAs(userId);
  return userId;
}

// ── setup ──────────────────────────────────────────────────────────────

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.announcements);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

// ── authorization ─────────────────────────────────────────────────────

describe("announcements authorization", () => {
  it("listAnnouncementsAction rejects unauthenticated callers", async () => {
    cookieJar.clear();
    await expect(listAnnouncementsAction()).rejects.toThrow("Not signed in");
  });

  it("listAnnouncementsAction rejects users without announcements:read", async () => {
    await signInAsBareUser();
    await expect(listAnnouncementsAction()).rejects.toThrow(
      "Forbidden: missing announcements:read",
    );
  });

  it("createAnnouncementAction rejects users without announcements:manage", async () => {
    await signInAsMember();
    await expect(
      createAnnouncementAction({ title: "x", body: "y" }),
    ).rejects.toThrow("Forbidden: missing announcements:manage");
  });

  it("updateAnnouncementAction rejects users without announcements:manage", async () => {
    await signInAsMember();
    await expect(
      updateAnnouncementAction({ id: "ann_x", title: "x", body: "y" }),
    ).rejects.toThrow("Forbidden: missing announcements:manage");
  });

  it("deleteAnnouncementAction rejects users without announcements:manage", async () => {
    await signInAsMember();
    await expect(deleteAnnouncementAction({ id: "ann_x" })).rejects.toThrow(
      "Forbidden: missing announcements:manage",
    );
  });
});

// ── happy path ────────────────────────────────────────────────────────

describe("announcements lifecycle", () => {
  it("admin can create, member can list", async () => {
    const adminId = await signInAsAdmin();
    const { id } = await createAnnouncementAction({
      title: "Trip signups open",
      body: "Sign up for the spring trip on the website.",
    });
    expect(id).toMatch(/^ann_/);

    await signInAsMember();
    const list = await listAnnouncementsAction();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].title).toBe("Trip signups open");
    expect(list[0].createdBy).toBe(adminId);
    expect(list[0].authorDisplayName).toBe("Test");
  });

  it("unread count drops to zero after markAnnouncementsReadAction", async () => {
    await signInAsAdmin();
    await createAnnouncementAction({ title: "a", body: "b" });

    await signInAsMember();
    let unread = await getUnreadCountAction();
    expect(unread.count).toBe(1);

    await markAnnouncementsReadAction();
    unread = await getUnreadCountAction();
    expect(unread.count).toBe(0);
  });

  it("only posts published after the marker count as unread", async () => {
    await signInAsAdmin();
    await createAnnouncementAction({ title: "first", body: "..." });

    const memberId = await signInAsMember();
    await markAnnouncementsReadAction();
    expect((await getUnreadCountAction()).count).toBe(0);

    // Bump the marker back by 1ms so a freshly inserted post lands strictly
    // after it. Without the bump, the post's `new Date()` and the marker
    // can collide on the same millisecond and the strict `>` comparison
    // hides the post.
    await getDb()
      .update(schema.users)
      .set({ lastReadAnnouncementsAt: new Date(Date.now() - 1) })
      .where(eq(schema.users.id, memberId));

    await signInAsAdmin("admin2@example.com");
    await createAnnouncementAction({ title: "second", body: "..." });

    cookieJar.clear();
    await openSession(memberId);
    expect((await getUnreadCountAction()).count).toBe(1);
  });

  it("admin can edit and delete", async () => {
    await signInAsAdmin();
    const { id } = await createAnnouncementAction({
      title: "draft",
      body: "first",
    });

    await updateAnnouncementAction({ id, title: "final", body: "ready" });
    let list = await listAnnouncementsAction();
    expect(list[0].title).toBe("final");
    expect(list[0].body).toBe("ready");

    await deleteAnnouncementAction({ id });
    list = await listAnnouncementsAction();
    expect(list).toHaveLength(0);
  });
});
