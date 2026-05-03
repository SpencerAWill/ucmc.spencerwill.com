import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as AvatarsServer from "#/server/r2/avatars.server";
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

// Track deleteAvatar calls so we can assert R2 cleanup runs.
const deleteAvatarSpy = vi.fn();
vi.mock("#/server/r2/avatars.server", async () => {
  const actual = await vi.importActual<typeof AvatarsServer>(
    "#/server/r2/avatars.server",
  );
  return {
    ...actual,
    deleteAvatar: async (key: string) => {
      deleteAvatarSpy(key);
    },
  };
});

const { deleteMyAccountAction } =
  await import("#/features/auth/server/magic-link-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(
  email: string,
  opts?: { avatarKey?: string | null },
): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    email,
    status: "approved",
    approvedAt: new Date(),
  });
  await db.insert(schema.profiles).values({
    userId: id,
    fullName: "Test User",
    preferredName: "Test",
    phone: "+15135551212",
    ucAffiliation: "student",
    avatarKey: opts?.avatarKey ?? null,
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

beforeEach(async () => {
  cookieJar.clear();
  deleteAvatarSpy.mockReset();
  const db = getDb();
  await db.delete(schema.waiverAttestations);
  await db.delete(schema.userRoles);
  await db.delete(schema.passkeyCredentials);
  await db.delete(schema.emergencyContacts);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

afterEach(() => {
  cookieJar.clear();
});

// ── tests ──────────────────────────────────────────────────────────────

describe("deleteMyAccountAction", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(deleteMyAccountAction()).rejects.toThrow("Not signed in");
  });

  it("removes the user row and cascades through all child tables", async () => {
    const userId = await seedUser("doomed@example.com");
    await assignRole(userId, "role_member");
    // Seed an emergency contact, a session, a passkey, and an
    // attestation — every cascading child the deletion must clean up.
    const db = getDb();
    await db.insert(schema.emergencyContacts).values({
      id: `ec_${crypto.randomUUID()}`,
      userId,
      name: "Bob",
      phone: "+15135559999",
      relationship: "parent",
    });
    await db.insert(schema.passkeyCredentials).values({
      id: `pk_${crypto.randomUUID()}`,
      userId,
      credentialId: `cred_${crypto.randomUUID()}`,
      publicKey: "fake",
      counter: 0,
      transports: null,
      nickname: null,
    });
    await db.insert(schema.waiverAttestations).values({
      id: `wa_${crypto.randomUUID()}`,
      userId,
      cycle: "2025-26",
      version: "v1",
      attestedAt: new Date(),
      attestedBy: userId,
    });
    await signInAs(userId);

    await deleteMyAccountAction();

    expect(
      await db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
    ).toBeUndefined();
    expect(
      await db.query.profiles.findFirst({
        where: eq(schema.profiles.userId, userId),
      }),
    ).toBeUndefined();
    const contacts = await db
      .select()
      .from(schema.emergencyContacts)
      .where(eq(schema.emergencyContacts.userId, userId));
    expect(contacts).toHaveLength(0);
    const passkeys = await db
      .select()
      .from(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.userId, userId));
    expect(passkeys).toHaveLength(0);
    const sessions = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId));
    expect(sessions).toHaveLength(0);
    const userRoles = await db
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId));
    expect(userRoles).toHaveLength(0);
    const attestations = await db
      .select()
      .from(schema.waiverAttestations)
      .where(eq(schema.waiverAttestations.userId, userId));
    expect(attestations).toHaveLength(0);
  });

  it("deletes the avatar from R2 when the user has one", async () => {
    const userId = await seedUser("withavatar@example.com", {
      avatarKey: "avatars/withavatar/abc123.webp",
    });
    await signInAs(userId);

    await deleteMyAccountAction();

    expect(deleteAvatarSpy).toHaveBeenCalledTimes(1);
    expect(deleteAvatarSpy).toHaveBeenCalledWith(
      "avatars/withavatar/abc123.webp",
    );
  });

  it("does NOT call deleteAvatar when the user has no avatar", async () => {
    const userId = await seedUser("noavatar@example.com");
    await signInAs(userId);

    await deleteMyAccountAction();

    expect(deleteAvatarSpy).not.toHaveBeenCalled();
  });

  it("refuses to delete the only remaining system_admin", async () => {
    const adminId = await seedUser("lonely-admin@example.com");
    await assignRole(adminId, "role_system_admin");
    await signInAs(adminId);

    await expect(deleteMyAccountAction()).rejects.toThrow(
      "only remaining system_admin",
    );

    // The user must still exist after the refused delete.
    const db = getDb();
    expect(
      await db.query.users.findFirst({
        where: eq(schema.users.id, adminId),
      }),
    ).toBeDefined();
  });

  it("permits deleting a system_admin when another exists", async () => {
    const otherAdminId = await seedUser("other-admin@example.com");
    await assignRole(otherAdminId, "role_system_admin");
    const selfId = await seedUser("self-admin@example.com");
    await assignRole(selfId, "role_system_admin");
    await signInAs(selfId);

    await deleteMyAccountAction();

    const db = getDb();
    expect(
      await db.query.users.findFirst({ where: eq(schema.users.id, selfId) }),
    ).toBeUndefined();
    // The other admin survives.
    expect(
      await db.query.users.findFirst({
        where: eq(schema.users.id, otherAdminId),
      }),
    ).toBeDefined();
  });

  it("preserves announcements authored by the deleted user (set null on author)", async () => {
    const userId = await seedUser("author@example.com");
    const db = getDb();
    await db.insert(schema.announcements).values({
      id: `ann_${crypto.randomUUID()}`,
      title: "before",
      body: "hello",
      createdBy: userId,
    });
    await signInAs(userId);

    await deleteMyAccountAction();

    const remaining = await db.select().from(schema.announcements);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.createdBy).toBeNull();
  });
});
