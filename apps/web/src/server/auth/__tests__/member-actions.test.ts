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

// Import after mocks.
const {
  deactivateMembersAction,
  reactivateMembersAction,
  unrejectMembersAction,
  revokeUserSessionsAction,
  adminUpdateProfileAction,
  listMembersAction,
  getMemberDetailAction,
} = await import("#/server/auth/member-actions.server");
const { openSession, loadCurrentPrincipal } =
  await import("#/features/auth/server/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(
  email: string,
  opts?: { status?: schema.UserStatus; withProfile?: boolean },
): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    email,
    status: opts?.status ?? "approved",
  });
  if (opts?.withProfile !== false) {
    await db.insert(schema.profiles).values({
      userId: id,
      fullName: "Test User",
      preferredName: "Test",
      mNumber: "M12345678",
      phone: "+15135551212",
      ucAffiliation: "student",
      updatedAt: new Date(),
    });
    await db.insert(schema.emergencyContacts).values({
      id: `ec_${crypto.randomUUID()}`,
      userId: id,
      name: "Emergency Contact",
      phone: "+15135551213",
      relationship: "other",
    });
  }
  return id;
}

async function publicIdOf(userId: string): Promise<string> {
  const row = await getDb()
    .select({ publicId: schema.users.publicId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!row) {
    throw new Error(`No user ${userId}`);
  }
  return row.publicId;
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

async function signInAsAdmin(): Promise<string> {
  const userId = await seedUser("admin@example.com");
  await assignRole(userId, "role_system_admin");
  await signInAs(userId);
  return userId;
}

async function signInAsMember(): Promise<string> {
  const userId = await seedUser("member@example.com");
  await assignRole(userId, "role_member");
  await signInAs(userId);
  return userId;
}

/**
 * Create an approved user with a specific permission via a custom role.
 */
async function signInWithPermission(
  email: string,
  permissionName: string,
): Promise<string> {
  const userId = await seedUser(email);
  await assignRole(userId, "role_member");

  const db = getDb();
  // Find the permission ID.
  const perm = await db.query.permissions.findFirst({
    where: eq(schema.permissions.name, permissionName),
  });
  if (!perm) {
    throw new Error(`Permission ${permissionName} not found`);
  }

  // Create a custom role with this permission.
  const roleId = `role_test_${permissionName.replace(":", "_")}`;
  await db
    .insert(schema.roles)
    .values({ id: roleId, name: `test_${permissionName.replace(":", "_")}` })
    .onConflictDoNothing();
  await db
    .insert(schema.rolePermissions)
    .values({ roleId, permissionId: perm.id })
    .onConflictDoNothing();
  await assignRole(userId, roleId);
  await signInAs(userId);
  return userId;
}

// ── setup ──────────────────────────────────────────────────────────────

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.userRoles);
  await db.delete(schema.rolePermissions);
  await db.delete(schema.sessions);
  await db.delete(schema.emergencyContacts);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
  // Remove test-created roles (keep seeded ones).
  for (const id of [
    "role_test_members_manage",
    "role_test_members_view_private",
    "role_test_sessions_revoke",
  ]) {
    await db.delete(schema.roles).where(eq(schema.roles.id, id));
  }
});

// ── authorization ─────────────────────────────────────────────────────

describe("authorization", () => {
  it("deactivateMembersAction rejects unauthenticated callers", async () => {
    cookieJar.clear();
    await expect(deactivateMembersAction(["x"])).rejects.toThrow(
      "Not signed in",
    );
  });

  it("deactivateMembersAction rejects callers without members:manage", async () => {
    await signInAsMember();
    await expect(deactivateMembersAction(["x"])).rejects.toThrow(
      "Forbidden: missing members:manage",
    );
  });

  it("reactivateMembersAction rejects callers without members:manage", async () => {
    await signInAsMember();
    await expect(reactivateMembersAction(["x"])).rejects.toThrow(
      "Forbidden: missing members:manage",
    );
  });

  it("unrejectMembersAction rejects callers without members:manage", async () => {
    await signInAsMember();
    await expect(unrejectMembersAction(["x"])).rejects.toThrow(
      "Forbidden: missing members:manage",
    );
  });

  it("revokeUserSessionsAction rejects callers without sessions:revoke", async () => {
    await signInAsMember();
    await expect(revokeUserSessionsAction("x")).rejects.toThrow(
      "Forbidden: missing sessions:revoke",
    );
  });

  it("adminUpdateProfileAction rejects callers without members:manage", async () => {
    await signInAsMember();
    await expect(
      adminUpdateProfileAction({
        userId: "x",
        fullName: "Test",
        preferredName: "Test",
        mNumber: "",
        phone: "+15135551212",
        emergencyContacts: [],
        ucAffiliation: "student",
      }),
    ).rejects.toThrow("Forbidden: missing members:manage");
  });
});

// ── self-protection ─────────────────────────────────────────────────────

describe("self-protection", () => {
  it("deactivateMembersAction prevents deactivating yourself", async () => {
    const adminId = await signInAsAdmin();
    await expect(deactivateMembersAction([adminId])).rejects.toThrow(
      "Cannot deactivate yourself",
    );
  });

  it("revokeUserSessionsAction prevents revoking your own sessions", async () => {
    const adminId = await signInAsAdmin();
    await expect(revokeUserSessionsAction(adminId)).rejects.toThrow(
      "Cannot revoke your own sessions",
    );
  });
});

// ── deactivation ────────────────────────────────────────────────────────

describe("deactivateMembersAction", () => {
  it("deactivates an approved user", async () => {
    await signInAsAdmin();
    const targetId = await seedUser("target@example.com");
    await assignRole(targetId, "role_member");

    await deactivateMembersAction([targetId]);

    const user = await getDb().query.users.findFirst({
      where: eq(schema.users.id, targetId),
    });
    expect(user!.status).toBe("deactivated");
  });

  it("deletes all sessions for deactivated users", async () => {
    await signInAsAdmin();
    const targetId = await seedUser("target@example.com");

    // Create sessions for the target user directly in the DB so we
    // don't overwrite the admin's session cookie.
    const db = getDb();
    await db.insert(schema.sessions).values({
      id: "sess_target_1",
      userId: targetId,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(schema.sessions).values({
      id: "sess_target_2",
      userId: targetId,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const sessionsBefore = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, targetId));
    expect(sessionsBefore).toHaveLength(2);

    await deactivateMembersAction([targetId]);

    const sessionsAfter = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, targetId));
    expect(sessionsAfter).toHaveLength(0);
  });

  it("is a no-op for non-approved users", async () => {
    await signInAsAdmin();
    const pendingId = await seedUser("pending@example.com", {
      status: "pending",
    });

    await deactivateMembersAction([pendingId]);

    const user = await getDb().query.users.findFirst({
      where: eq(schema.users.id, pendingId),
    });
    expect(user!.status).toBe("pending");
  });

  it("deactivates multiple users in bulk", async () => {
    await signInAsAdmin();
    const id1 = await seedUser("bulk1@example.com");
    const id2 = await seedUser("bulk2@example.com");
    await assignRole(id1, "role_member");
    await assignRole(id2, "role_member");

    await deactivateMembersAction([id1, id2]);

    const u1 = await getDb().query.users.findFirst({
      where: eq(schema.users.id, id1),
    });
    const u2 = await getDb().query.users.findFirst({
      where: eq(schema.users.id, id2),
    });
    expect(u1!.status).toBe("deactivated");
    expect(u2!.status).toBe("deactivated");
  });
});

// ── reactivation ────────────────────────────────────────────────────────

describe("reactivateMembersAction", () => {
  it("reactivates a deactivated user", async () => {
    const adminId = await signInAsAdmin();
    const targetId = await seedUser("target@example.com");
    await assignRole(targetId, "role_member");

    // Deactivate first.
    await deactivateMembersAction([targetId]);
    const deactivated = await getDb().query.users.findFirst({
      where: eq(schema.users.id, targetId),
    });
    expect(deactivated!.status).toBe("deactivated");

    // Reactivate.
    await reactivateMembersAction([targetId]);

    const user = await getDb().query.users.findFirst({
      where: eq(schema.users.id, targetId),
    });
    expect(user!.status).toBe("approved");
    expect(user!.approvedBy).toBe(adminId);
    expect(user!.approvedAt).toBeTruthy();
  });

  it("grants the member role on reactivation", async () => {
    await signInAsAdmin();
    const targetId = await seedUser("target@example.com");

    // Deactivate and reactivate.
    await deactivateMembersAction([targetId]);
    await reactivateMembersAction([targetId]);

    const roles = await getDb()
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, targetId));
    expect(roles.some((r) => r.roleId === "role_member")).toBe(true);
  });

  it("is a no-op for non-deactivated users", async () => {
    await signInAsAdmin();
    const approvedId = await seedUser("approved@example.com");

    await reactivateMembersAction([approvedId]);

    const user = await getDb().query.users.findFirst({
      where: eq(schema.users.id, approvedId),
    });
    // Status remains approved (not re-stamped by reactivation).
    expect(user!.status).toBe("approved");
  });
});

// ── un-reject ───────────────────────────────────────────────────────────

describe("unrejectMembersAction", () => {
  it("moves a rejected user back to pending", async () => {
    await signInAsAdmin();
    const targetId = await seedUser("target@example.com", {
      status: "rejected",
    });

    await unrejectMembersAction([targetId]);

    const user = await getDb().query.users.findFirst({
      where: eq(schema.users.id, targetId),
    });
    expect(user!.status).toBe("pending");
  });

  it("is a no-op for non-rejected users", async () => {
    await signInAsAdmin();
    const approvedId = await seedUser("approved@example.com");

    await unrejectMembersAction([approvedId]);

    const user = await getDb().query.users.findFirst({
      where: eq(schema.users.id, approvedId),
    });
    expect(user!.status).toBe("approved");
  });

  it("un-rejects multiple users in bulk", async () => {
    await signInAsAdmin();
    const id1 = await seedUser("rej1@example.com", { status: "rejected" });
    const id2 = await seedUser("rej2@example.com", { status: "rejected" });

    await unrejectMembersAction([id1, id2]);

    const u1 = await getDb().query.users.findFirst({
      where: eq(schema.users.id, id1),
    });
    const u2 = await getDb().query.users.findFirst({
      where: eq(schema.users.id, id2),
    });
    expect(u1!.status).toBe("pending");
    expect(u2!.status).toBe("pending");
  });
});

// ── session revocation ──────────────────────────────────────────────────

describe("revokeUserSessionsAction", () => {
  it("deletes all sessions for the target user", async () => {
    await signInAsAdmin();
    const targetId = await seedUser("target@example.com");

    // Insert sessions directly so we don't overwrite the admin cookie.
    const db = getDb();
    await db.insert(schema.sessions).values({
      id: "sess_rev_1",
      userId: targetId,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(schema.sessions).values({
      id: "sess_rev_2",
      userId: targetId,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const before = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, targetId));
    expect(before).toHaveLength(2);

    await revokeUserSessionsAction(targetId);

    const after = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, targetId));
    expect(after).toHaveLength(0);
  });

  it("is a no-op for a user with no sessions", async () => {
    await signInAsAdmin();
    const targetId = await seedUser("target@example.com");

    // Should not throw.
    await revokeUserSessionsAction(targetId);
  });
});

// ── admin profile editing ───────────────────────────────────────────────

describe("adminUpdateProfileAction", () => {
  it("updates another user's profile", async () => {
    await signInAsAdmin();
    const targetId = await seedUser("target@example.com");

    await adminUpdateProfileAction({
      userId: targetId,
      fullName: "Updated Name",
      preferredName: "Updated",
      mNumber: "M99999999",
      phone: "+15135559999",
      emergencyContacts: [
        {
          name: "New EC",
          phone: "+15135559998",
          relationship: "friend" as const,
        },
      ],
      ucAffiliation: "faculty",
    });

    const profile = await getDb().query.profiles.findFirst({
      where: eq(schema.profiles.userId, targetId),
    });
    expect(profile!.fullName).toBe("Updated Name");
    expect(profile!.preferredName).toBe("Updated");
    expect(profile!.mNumber).toBe("M99999999");
    expect(profile!.ucAffiliation).toBe("faculty");
  });

  it("creates a profile for a user who doesn't have one", async () => {
    await signInAsAdmin();
    const targetId = await seedUser("noprofile@example.com", {
      withProfile: false,
    });

    await adminUpdateProfileAction({
      userId: targetId,
      fullName: "New Profile",
      preferredName: "New",
      mNumber: "",
      phone: "+15135551111",
      emergencyContacts: [],
      ucAffiliation: "community",
    });

    const profile = await getDb().query.profiles.findFirst({
      where: eq(schema.profiles.userId, targetId),
    });
    expect(profile).toBeDefined();
    expect(profile!.fullName).toBe("New Profile");
  });

  it("throws for nonexistent user", async () => {
    await signInAsAdmin();
    await expect(
      adminUpdateProfileAction({
        userId: "nonexistent",
        fullName: "Test",
        preferredName: "Test",
        mNumber: "",
        phone: "+15135551212",
        emergencyContacts: [],
        ucAffiliation: "student",
      }),
    ).rejects.toThrow("User not found");
  });
});

// ── private data in listMembersAction ───────────────────────────────────

describe("listMembersAction private data", () => {
  it("returns null for private fields without members:view_private", async () => {
    await signInAsMember();

    const anotherMember = await seedUser("visible@example.com");
    await assignRole(anotherMember, "role_member");

    const result = await listMembersAction({});
    const target = result.rows.find((r) => r.email === "visible@example.com");
    expect(target).toBeDefined();
    expect(target!.phone).toBeNull();
    expect(target!.emergencyContacts).toEqual([]);
    expect(target!.mNumber).toBeNull();
  });

  it("returns private fields with members:view_private", async () => {
    await signInWithPermission("viewer@example.com", "members:view_private");

    const anotherMember = await seedUser("visible@example.com");
    await assignRole(anotherMember, "role_member");

    const result = await listMembersAction({});
    const target = result.rows.find((r) => r.email === "visible@example.com");
    expect(target).toBeDefined();
    expect(target!.phone).toBe("+15135551212");
    expect(target!.emergencyContacts).toEqual([
      {
        name: "Emergency Contact",
        phone: "+15135551213",
        relationship: "other",
      },
    ]);
    expect(target!.mNumber).toBe("M12345678");
  });

  it("includes status field in the response", async () => {
    await signInAsMember();

    const result = await listMembersAction({});
    for (const row of result.rows) {
      expect(row.status).toBe("approved");
    }
  });
});

// ── status filtering in listMembersAction ───────────────────────────────

describe("listMembersAction status filtering", () => {
  it("non-managers only see approved users regardless of statuses param", async () => {
    await signInAsMember();

    await seedUser("deactivated@example.com", { status: "deactivated" });

    // Try to request deactivated users — should be ignored.
    const result = await listMembersAction({ statuses: "deactivated" });
    expect(result.rows.every((r) => r.status === "approved")).toBe(true);
    expect(
      result.rows.find((r) => r.email === "deactivated@example.com"),
    ).toBeUndefined();
  });

  it("members:manage holders can filter by deactivated status", async () => {
    await signInWithPermission("manager@example.com", "members:manage");

    const deactivatedId = await seedUser("deactivated@example.com", {
      status: "deactivated",
    });
    await assignRole(deactivatedId, "role_member");

    const result = await listMembersAction({ statuses: "deactivated" });
    expect(result.rows.some((r) => r.email === "deactivated@example.com")).toBe(
      true,
    );
    expect(result.rows.every((r) => r.status === "deactivated")).toBe(true);
  });

  it("members:manage holders can filter by multiple statuses", async () => {
    await signInWithPermission("manager@example.com", "members:manage");

    await seedUser("rejected@example.com", { status: "rejected" });
    await seedUser("pending@example.com", { status: "pending" });

    const result = await listMembersAction({ statuses: "rejected,pending" });
    const emails = result.rows.map((r) => r.email);
    expect(emails).toContain("rejected@example.com");
    expect(emails).toContain("pending@example.com");
    // Manager themselves (approved) should not appear.
    expect(emails).not.toContain("manager@example.com");
  });

  it("members:manage holders default to approved when no statuses param", async () => {
    await signInWithPermission("manager@example.com", "members:manage");

    await seedUser("deactivated@example.com", { status: "deactivated" });
    await seedUser("approved@example.com");
    await assignRole(
      (await getDb().query.users.findFirst({
        where: eq(schema.users.email, "approved@example.com"),
      }))!.id,
      "role_member",
    );

    const result = await listMembersAction({});
    expect(result.rows.every((r) => r.status === "approved")).toBe(true);
  });
});

// ── getMemberDetailAction ───────────────────────────────────────────────

describe("getMemberDetailAction", () => {
  it("returns basic member info for any approved caller", async () => {
    await signInAsMember();

    const targetId = await seedUser("target@example.com");
    await assignRole(targetId, "role_member");

    const detail = await getMemberDetailAction(await publicIdOf(targetId));
    expect(detail.userId).toBe(targetId);
    expect(detail.publicId).toMatch(/^[a-z0-9]+$/);
    expect(detail.email).toBe("target@example.com");
    expect(detail.status).toBe("approved");
    expect(detail.fullName).toBe("Test User");
    expect(detail.roles).toContain("member");
    // Private fields should be null/empty.
    expect(detail.phone).toBeNull();
    expect(detail.mNumber).toBeNull();
    expect(detail.emergencyContacts).toEqual([]);
    // Session count should be null.
    expect(detail.activeSessions).toBeNull();
  });

  it("includes private fields for members:view_private holders", async () => {
    await signInWithPermission("viewer@example.com", "members:view_private");

    const targetId = await seedUser("target@example.com");

    const detail = await getMemberDetailAction(await publicIdOf(targetId));
    expect(detail.phone).toBe("+15135551212");
    expect(detail.emergencyContacts).toEqual([
      {
        name: "Emergency Contact",
        phone: "+15135551213",
        relationship: "other",
      },
    ]);
    expect(detail.mNumber).toBe("M12345678");
  });

  it("includes session count for sessions:revoke holders", async () => {
    await signInWithPermission("revoker@example.com", "sessions:revoke");

    const targetId = await seedUser("target@example.com");

    // Insert a session directly so we don't overwrite the revoker's cookie.
    await getDb()
      .insert(schema.sessions)
      .values({
        id: "sess_detail_1",
        userId: targetId,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });

    const detail = await getMemberDetailAction(await publicIdOf(targetId));
    expect(detail.activeSessions).toBe(1);
  });

  it("throws for nonexistent user", async () => {
    await signInAsMember();
    await expect(getMemberDetailAction("nonexistent")).rejects.toThrow(
      "User not found",
    );
  });
});

// ── loadCurrentPrincipal deactivated check ──────────────────────────────

describe("loadCurrentPrincipal deactivated check", () => {
  it("returns null and cleans up session for deactivated users", async () => {
    const targetId = await seedUser("target@example.com");
    await signInAs(targetId);

    // Verify session works initially.
    const before = await loadCurrentPrincipal();
    expect(before).not.toBeNull();
    expect(before!.email).toBe("target@example.com");

    // Deactivate the user directly in the database.
    await getDb()
      .update(schema.users)
      .set({ status: "deactivated" })
      .where(eq(schema.users.id, targetId));

    // loadCurrentPrincipal should now return null and clean up.
    const after = await loadCurrentPrincipal();
    expect(after).toBeNull();

    // Session row should be deleted.
    const sessions = await getDb()
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, targetId));
    expect(sessions).toHaveLength(0);
  });
});
