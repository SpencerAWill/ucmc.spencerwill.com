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

// Import after mocks.
const {
  deactivateMembersAction,
  reactivateMembersAction,
  unrejectMembersAction,
  revokeUserSessionsAction,
  adminUpdateProfileAction,
  listMembersAction,
  listRolesAction,
  getMemberDetailAction,
  rejectRegistrationsAction,
  approveRegistrationsAction,
  banMembersAction,
  unbanMembersAction,
} = await import("#/features/members/server/member-actions.server");
const { reorderRolesAction, getUserRolesAction } =
  await import("#/features/members/server/rbac-actions.server");
const { openSession, loadCurrentPrincipal } =
  await import("#/server/auth/session.server");
const { loadPrincipal } = await import("#/server/auth/principal.server");

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
    status: opts?.status ?? "approved",
  });
  await attachPrimaryEmail(id, email);
  if (opts?.withProfile !== false) {
    await db.insert(schema.profiles).values({
      userId: id,
      fullName: "Test User",
      preferredName: "Test",
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
  // Drop the blocklist alongside the user state — banMembersAction
  // mirrors verified emails into `banned_emails`, and a residual row
  // from a prior test would falsely pass the "blocklist gets seeded"
  // assertion in the next one.
  await db.delete(schema.bannedEmails);
  // Remove test-created roles (keep seeded ones).
  for (const id of [
    "role_test_members_manage",
    "role_test_members_view_private",
    "role_test_sessions_revoke",
    "role_test_members_ban",
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

  it("banMembersAction rejects callers without members:ban", async () => {
    await signInAsMember();
    await expect(
      banMembersAction({ userIds: ["x"], reason: "policy violation" }),
    ).rejects.toThrow("Forbidden: missing members:ban");
  });

  it("unbanMembersAction rejects callers without members:ban", async () => {
    await signInAsMember();
    await expect(unbanMembersAction(["x"])).rejects.toThrow(
      "Forbidden: missing members:ban",
    );
  });

  it("members:manage alone is not enough to ban", async () => {
    // Ban is gated by `members:ban` specifically — a user with
    // `members:manage` (the rest of the lifecycle surface) should
    // still be refused. This pins the permission split that the
    // action layer enforces.
    await signInWithPermission("manager@example.com", "members:manage");
    await expect(
      banMembersAction({ userIds: ["x"], reason: "policy violation" }),
    ).rejects.toThrow("Forbidden: missing members:ban");
  });

  it("adminUpdateProfileAction rejects callers without members:manage", async () => {
    await signInAsMember();
    await expect(
      adminUpdateProfileAction({
        userId: "x",
        fullName: "Test",
        preferredName: "Test",
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

// ── ban / unban ─────────────────────────────────────────────────────────

describe("banMembersAction", () => {
  it("flips status to banned and stamps the actor + reason", async () => {
    const adminId = await signInAsAdmin();
    const targetId = await seedUser("victim@example.com");
    await assignRole(targetId, "role_member");

    await banMembersAction({ userIds: [targetId], reason: "policy violation" });

    const user = await getDb().query.users.findFirst({
      where: eq(schema.users.id, targetId),
    });
    expect(user!.status).toBe("banned");
    expect(user!.bannedAt).not.toBeNull();
    expect(user!.bannedBy).toBe(adminId);
    expect(user!.bannedReason).toBe("policy violation");
  });

  it("mirrors every verified email of the user into banned_emails", async () => {
    await signInAsAdmin();
    const targetId = await seedUser("primary@example.com");
    // Add a second verified email — banMembers should pick up both.
    const db = getDb();
    await db.insert(schema.userEmails).values({
      id: `uem_${crypto.randomUUID()}`,
      userId: targetId,
      email: "alt@example.com",
      isPrimary: false,
      verifiedAt: new Date(),
    });

    await banMembersAction({ userIds: [targetId], reason: "policy violation" });

    const blocklist = await db
      .select()
      .from(schema.bannedEmails)
      .where(eq(schema.bannedEmails.userId, targetId));
    const emails = blocklist.map((r) => r.email).sort();
    expect(emails).toEqual(["alt@example.com", "primary@example.com"]);
    for (const row of blocklist) {
      expect(row.reason).toBe("policy violation");
    }
  });

  it("purges the target's active sessions", async () => {
    await signInAsAdmin();
    const targetId = await seedUser("victim@example.com");

    const db = getDb();
    await db.insert(schema.sessions).values({
      id: "sess_ban_1",
      userId: targetId,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await banMembersAction({ userIds: [targetId], reason: "policy violation" });

    const after = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, targetId));
    expect(after).toHaveLength(0);
  });

  it("refuses to ban yourself", async () => {
    const adminId = await signInAsAdmin();
    await expect(
      banMembersAction({ userIds: [adminId], reason: "policy violation" }),
    ).rejects.toThrow("Cannot ban yourself");
  });

  it("refuses to ban the only remaining system_admin", async () => {
    // Ban-the-last-admin lockout: parallel to deleteMyAccountAction's
    // self-protection. With two admins (caller + target), banning the
    // target leaves zero admins and must be refused before any side
    // effect lands.
    const adminId = await signInAsAdmin();
    const otherAdminId = await seedUser("other-admin@example.com");
    await assignRole(otherAdminId, "role_system_admin");

    // Self-ban check fires first when caller is in the list — exclude
    // the caller so the last-admin guard is what trips. Banning the
    // *only other* admin while caller is still admin is fine (caller
    // remains). To force the last-admin path we sign in as a fresh
    // banner-with-no-admin-role and target the remaining admin.
    await banMembersAction({
      userIds: [otherAdminId],
      reason: "policy violation",
    });

    // Now sign in as a non-admin holder of `members:ban` and try to
    // ban the remaining admin (adminId). With only one admin left and
    // that admin in the target set, the guard refuses.
    await signInWithPermission("banner@example.com", "members:ban");
    await expect(
      banMembersAction({ userIds: [adminId], reason: "policy violation" }),
    ).rejects.toThrow(/only remaining system_admin/i);
  });

  it("strips user_roles at ban time", async () => {
    // Ban resets privileges to zero. Without this, an unban → pending
    // → re-approve sequence would silently restore officer roles via
    // `INSERT OR IGNORE role_member` (which would no-op against the
    // surviving officer assignments).
    await signInAsAdmin();
    const targetId = await seedUser("officer-victim@example.com");
    await assignRole(targetId, "role_member");
    await assignRole(targetId, "role_president");

    await banMembersAction({ userIds: [targetId], reason: "policy violation" });

    const remaining = await getDb()
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, targetId));
    expect(remaining).toHaveLength(0);
  });

  it("is a no-op for unclaimed stubs (excluded by status filter)", async () => {
    await signInAsAdmin();
    const stubId = await seedUser("stub@example.com", {
      status: "unclaimed",
      withProfile: false,
    });

    await banMembersAction({ userIds: [stubId], reason: "policy violation" });

    const user = await getDb().query.users.findFirst({
      where: eq(schema.users.id, stubId),
    });
    expect(user!.status).toBe("unclaimed");
    const blocklist = await getDb()
      .select()
      .from(schema.bannedEmails)
      .where(eq(schema.bannedEmails.userId, stubId));
    expect(blocklist).toHaveLength(0);
  });

  it("re-banning an already-banned user is idempotent", async () => {
    await signInAsAdmin();
    const targetId = await seedUser("victim@example.com");

    await banMembersAction({ userIds: [targetId], reason: "first reason" });
    // Second call: status filter excludes "banned", so neither status
    // nor blocklist should churn. The ON CONFLICT DO NOTHING in the
    // blocklist insert is also exercised here.
    await banMembersAction({ userIds: [targetId], reason: "second reason" });

    const user = await getDb().query.users.findFirst({
      where: eq(schema.users.id, targetId),
    });
    expect(user!.bannedReason).toBe("first reason");
    const blocklist = await getDb()
      .select()
      .from(schema.bannedEmails)
      .where(eq(schema.bannedEmails.userId, targetId));
    expect(blocklist).toHaveLength(1);
    expect(blocklist[0].reason).toBe("first reason");
  });

  it("blocklist row survives user-row delete (ON DELETE SET NULL)", async () => {
    // The independence-from-user-row invariant — a banned user who
    // self-deletes (or is purged by a future retention sweep) must not
    // free up the address. The blocklist row's `userId` becomes NULL
    // but the email stays blocked.
    await signInAsAdmin();
    const targetId = await seedUser("victim@example.com");

    await banMembersAction({ userIds: [targetId], reason: "policy violation" });

    const db = getDb();
    await db.delete(schema.users).where(eq(schema.users.id, targetId));

    const blocklist = await db
      .select()
      .from(schema.bannedEmails)
      .where(eq(schema.bannedEmails.email, "victim@example.com"));
    expect(blocklist).toHaveLength(1);
    expect(blocklist[0].userId).toBeNull();
  });

  it("writes a member.banned audit row with reason + count metadata", async () => {
    const adminId = await signInAsAdmin();
    const targetId = await seedUser("victim@example.com");

    await banMembersAction({ userIds: [targetId], reason: "policy violation" });

    const audit = await getDb().query.auditLog.findFirst({
      where: eq(schema.auditLog.targetUserId, targetId),
    });
    expect(audit).toBeDefined();
    expect(audit!.action).toBe("member.banned");
    expect(audit!.actorUserId).toBe(adminId);
    const meta = JSON.parse(audit!.metadataJson!) as {
      reason: string;
      emailsBlocked: number;
    };
    expect(meta.reason).toBe("policy violation");
    expect(meta.emailsBlocked).toBe(1);
  });
});

describe("unbanMembersAction", () => {
  it("flips banned to pending and clears the user's ban columns", async () => {
    await signInAsAdmin();
    const targetId = await seedUser("victim@example.com");
    await banMembersAction({ userIds: [targetId], reason: "policy violation" });

    await unbanMembersAction([targetId]);

    const user = await getDb().query.users.findFirst({
      where: eq(schema.users.id, targetId),
    });
    expect(user!.status).toBe("pending");
    expect(user!.bannedAt).toBeNull();
    expect(user!.bannedBy).toBeNull();
    expect(user!.bannedReason).toBeNull();
  });

  it("clears stale lifecycle timestamps from a prior life", async () => {
    // A user can land on `banned` from multiple prior states — they
    // may have been approved/deactivated/rejected before. Without
    // clearing those timestamps on unban, the row reads as "approved
    // by X on date Y, also rejected on Z, also banned" simultaneously
    // after unban. Mirrors `unrejectMembersAction` clearing
    // `rejectedAt` and `reactivateMembersAction` clearing
    // `deactivatedAt`.
    const adminId = await signInAsAdmin();
    const targetId = await seedUser("victim@example.com");
    // Stamp prior-life timestamps directly so the test doesn't depend
    // on the exact lifecycle path the user took to reach `banned`.
    const db = getDb();
    await db
      .update(schema.users)
      .set({
        approvedAt: new Date("2024-01-01"),
        approvedBy: adminId,
        deactivatedAt: new Date("2024-06-01"),
        rejectedAt: new Date("2024-09-01"),
      })
      .where(eq(schema.users.id, targetId));
    await banMembersAction({ userIds: [targetId], reason: "policy violation" });

    await unbanMembersAction([targetId]);

    const user = await getDb().query.users.findFirst({
      where: eq(schema.users.id, targetId),
    });
    expect(user!.approvedAt).toBeNull();
    expect(user!.approvedBy).toBeNull();
    expect(user!.deactivatedAt).toBeNull();
    expect(user!.rejectedAt).toBeNull();
  });

  it("removes the user's blocklist rows", async () => {
    await signInAsAdmin();
    const targetId = await seedUser("victim@example.com");
    await banMembersAction({ userIds: [targetId], reason: "policy violation" });

    await unbanMembersAction([targetId]);

    const blocklist = await getDb()
      .select()
      .from(schema.bannedEmails)
      .where(eq(schema.bannedEmails.userId, targetId));
    expect(blocklist).toHaveLength(0);
  });

  it("does not touch orphaned blocklist rows from a prior banned user", async () => {
    // Orphaned (`userId` IS NULL) entries represent a previously-
    // banned user whose row was deleted. Unbanning a different user
    // must not coincidentally clear them.
    const adminId = await signInAsAdmin();
    const db = getDb();
    await db.insert(schema.bannedEmails).values({
      email: "ghost@example.com",
      userId: null,
      bannedAt: new Date(),
      bannedBy: adminId,
      reason: "old ban",
      createdAt: new Date(),
    });

    const targetId = await seedUser("victim@example.com");
    await banMembersAction({ userIds: [targetId], reason: "policy violation" });
    await unbanMembersAction([targetId]);

    const orphan = await db
      .select()
      .from(schema.bannedEmails)
      .where(eq(schema.bannedEmails.email, "ghost@example.com"));
    expect(orphan).toHaveLength(1);
  });

  it("is a no-op for non-banned users", async () => {
    await signInAsAdmin();
    const approvedId = await seedUser("approved@example.com");

    await unbanMembersAction([approvedId]);

    const user = await getDb().query.users.findFirst({
      where: eq(schema.users.id, approvedId),
    });
    expect(user!.status).toBe("approved");
  });

  it("writes a member.unbanned audit row with emailsUnblocked count", async () => {
    const adminId = await signInAsAdmin();
    const targetId = await seedUser("victim@example.com");
    await banMembersAction({ userIds: [targetId], reason: "policy violation" });
    // Clear the ban audit so the next read finds the unban row first.
    const db = getDb();
    await db.delete(schema.auditLog);

    await unbanMembersAction([targetId]);

    const audit = await db.query.auditLog.findFirst({
      where: eq(schema.auditLog.targetUserId, targetId),
    });
    expect(audit).toBeDefined();
    expect(audit!.action).toBe("member.unbanned");
    expect(audit!.actorUserId).toBe(adminId);
    const meta = JSON.parse(audit!.metadataJson!) as {
      emailsUnblocked: number;
    };
    expect(meta.emailsUnblocked).toBe(1);
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
      (await getDb().query.userEmails.findFirst({
        where: eq(schema.userEmails.email, "approved@example.com"),
      }))!.userId,
      "role_member",
    );

    const result = await listMembersAction({});
    expect(result.rows.every((r) => r.status === "approved")).toBe(true);
  });
});

// ── role filtering in listMembersAction ────────────────────────────────

describe("listMembersAction role filter", () => {
  it("returns only members holding any of the requested roles, with a matching total", async () => {
    await signInWithPermission("manager@example.com", "members:manage");

    const officerId = await seedUser("officer@example.com");
    await assignRole(officerId, "role_member");
    await assignRole(officerId, "role_president");

    const plainId = await seedUser("plain@example.com");
    await assignRole(plainId, "role_member");

    const filtered = await listMembersAction({ roles: "president" });
    const emails = filtered.rows.map((r) => r.email);
    expect(emails).toContain("officer@example.com");
    expect(emails).not.toContain("plain@example.com");
    // total must reflect the filtered set, not the unfiltered page count.
    expect(filtered.total).toBe(filtered.rows.length);
  });

  it("paginates correctly under a role filter", async () => {
    await signInWithPermission("manager@example.com", "members:manage");

    for (let i = 0; i < 3; i++) {
      const id = await seedUser(`officer${i}@example.com`);
      await assignRole(id, "role_member");
      await assignRole(id, "role_president");
    }
    // Decoy that should not appear in the role-filtered total.
    const decoy = await seedUser("decoy@example.com");
    await assignRole(decoy, "role_member");

    const page = await listMembersAction({ roles: "president", limit: 2 });
    expect(page.rows.length).toBe(2);
    expect(page.total).toBe(3);
    for (const row of page.rows) {
      expect(row.roles).toContain("president");
    }
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
    expect(before!.primaryEmail).toBe("target@example.com");

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

// ── audit-log integration ──────────────────────────────────────────────
//
// These tests guard the bulk-lifecycle audit fix from PR #41 review:
// the audit row count must equal the count of users that ACTUALLY
// transitioned, not the raw `userIds[]` length. Without `.returning()`
// on the UPDATE, a stale or malformed request was producing
// false-positive audit entries for accounts that didn't change state.

describe("audit log: bulk lifecycle audits transitions, not requests", () => {
  it("rejectRegistrationsAction: nonexistent IDs don't produce audit rows", async () => {
    await signInAsAdmin();
    const pendingId = await seedUser("pending@example.com", {
      status: "pending",
    });

    // Mix of a valid pending user + a bogus ID. `rejectRegistrationsAction`
    // doesn't filter on prior status (so it can also operate on an
    // already-rejected row idempotently), but it MUST refuse to emit
    // an audit row for an ID the UPDATE didn't touch.
    await rejectRegistrationsAction([pendingId, "user_does_not_exist"]);

    const rejectedRows = await getDb()
      .select({ targetUserId: schema.auditLog.targetUserId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "registration.rejected"));

    expect(rejectedRows).toHaveLength(1);
    expect(rejectedRows[0]?.targetUserId).toBe(pendingId);
  });

  it("deactivateMembersAction: only audits approved users that actually transitioned", async () => {
    await signInAsAdmin();
    const approvedId = await seedUser("approved-bulk@example.com", {
      status: "approved",
    });
    const pendingId = await seedUser("pending-bulk@example.com", {
      status: "pending",
    });
    const rejectedId = await seedUser("rejected-bulk@example.com", {
      status: "rejected",
    });

    await deactivateMembersAction([
      approvedId,
      pendingId,
      rejectedId,
      "user_does_not_exist",
    ]);

    const auditRows = await getDb()
      .select({ targetUserId: schema.auditLog.targetUserId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "member.deactivated"));

    // Only the approved user actually transitioned to deactivated;
    // the audit log must reflect that and not advertise phantom
    // deactivations for the other three IDs.
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.targetUserId).toBe(approvedId);
  });

  it("unrejectMembersAction: only audits rejected users that actually transitioned", async () => {
    await signInAsAdmin();
    const rejectedId = await seedUser("rejected-unreject@example.com", {
      status: "rejected",
    });
    const pendingId = await seedUser("pending-unreject@example.com", {
      status: "pending",
    });

    await unrejectMembersAction([rejectedId, pendingId, "user_does_not_exist"]);

    const auditRows = await getDb()
      .select({ targetUserId: schema.auditLog.targetUserId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "registration.unrejected"));

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.targetUserId).toBe(rejectedId);
  });

  it("approveRegistrationsAction: dedupes and ignores nonexistent IDs in the audit log", async () => {
    await signInAsAdmin();
    const pendingId = await seedUser("pending-approve@example.com", {
      status: "pending",
    });

    // Pass the same pending id twice plus a bogus id. The fix routes
    // through `.returning({ id })`, which means the UPDATE returns the
    // affected row once (per existing `pendingId`) regardless of how
    // many times the caller sent it, and skips the bogus id entirely.
    await approveRegistrationsAction([
      pendingId,
      pendingId,
      "user_does_not_exist",
    ]);

    const approvedRows = await getDb()
      .select({ targetUserId: schema.auditLog.targetUserId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "registration.approved"));

    expect(approvedRows).toHaveLength(1);
    expect(approvedRows[0]?.targetUserId).toBe(pendingId);
  });

  it("revokeUserSessionsAction: writes a member.sessions_revoked audit row with revokedCount metadata", async () => {
    const adminId = await signInAsAdmin();
    const targetId = await seedUser("revoke-target@example.com");
    const db = getDb();

    // Seed two sessions for the target so we can verify the count is
    // captured and not just the existence of the action.
    await db.insert(schema.sessions).values([
      {
        id: "sess_revoke_1",
        userId: targetId,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      {
        id: "sess_revoke_2",
        userId: targetId,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    ]);

    await revokeUserSessionsAction(targetId);

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "member.sessions_revoked"));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.actorUserId).toBe(adminId);
    expect(auditRows[0]?.targetUserId).toBe(targetId);
    expect(JSON.parse(auditRows[0]?.metadataJson ?? "")).toEqual({
      revokedCount: 2,
    });
  });

  it("revokeUserSessionsAction: writes NO audit row when the user had no active sessions", async () => {
    await signInAsAdmin();
    const targetId = await seedUser("revoke-empty@example.com");

    await revokeUserSessionsAction(targetId);

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "member.sessions_revoked"));
    expect(auditRows).toHaveLength(0);
  });
});

// ── role-display ordering ──────────────────────────────────────────────
//
// Every server query that loads a role list must order by
// `(position, name)` so client renderers (role badges, role-filter
// popover, user-menu emulation list) reflect the operator-controlled
// ordering set in `/members/roles`. Regression: previously these
// queries used `name`-only or no ordering, drifting from the RBAC
// editor.

describe("role list ordering matches reorderRolesAction", () => {
  it("listRolesAction, getUserRolesAction, and loadPrincipal all respect role position", async () => {
    const adminId = await signInAsAdmin();

    // Seed two extra roles so reordering produces a deterministic,
    // non-alphabetical sequence. Names chosen so alphabetical sort
    // would NOT match position sort, surfacing the bug if a query
    // forgot the position clause. Clean first so re-runs in the same
    // vitest worker don't collide on the unique id constraint
    // (`beforeEach` wipes user_roles but not the role rows themselves).
    const db = getDb();
    await db.delete(schema.roles).where(eq(schema.roles.id, "role_zeta"));
    await db.delete(schema.roles).where(eq(schema.roles.id, "role_alpha"));
    await db.insert(schema.roles).values([
      { id: "role_zeta", name: "zeta", position: 0 },
      { id: "role_alpha", name: "alpha", position: 1 },
    ]);

    // Assign both new roles + system_admin to the admin user so the
    // per-user queries (`getUserRolesAction`, `loadPrincipal`) have
    // multiple rows to order.
    await assignRole(adminId, "role_zeta");
    await assignRole(adminId, "role_alpha");

    // Pull canonical order from the RBAC editor's source of truth, then
    // reverse it via reorderRolesAction so position diverges from the
    // alphabetical default.
    const before = await listRolesAction();
    const reversed = [...before].reverse().map((r) => r.id);
    await reorderRolesAction({ orderedRoleIds: reversed });

    // 1) Directory's role-filter popover query.
    const afterListRoles = await listRolesAction();
    expect(afterListRoles.map((r) => r.id)).toEqual(reversed);

    // 2) Per-user role list (RoleAssignmentSheet).
    const userRoles = await getUserRolesAction(adminId);
    const userRoleIds = userRoles.map((r) => r.roleId);
    // Filter the canonical reversed order down to the roles this user
    // actually has — preserves position order, which is what the
    // assignment UI displays.
    const expectedUserRoles = reversed.filter((id) => userRoleIds.includes(id));
    expect(userRoleIds).toEqual(expectedUserRoles);

    // 3) Principal's `roles` array (drives `useAuth().roles`, the user
    //    menu's emulation list, and any permission-derived UI).
    const principal = await loadPrincipal(adminId);
    expect(principal).not.toBeNull();
    const principalRoleNames = principal!.roles;
    // Map reversed role ids back to names via the listRolesAction
    // result; filter to roles the user has.
    const idToName = new Map(afterListRoles.map((r) => [r.id, r.name]));
    const expectedPrincipalNames = reversed
      .filter((id) => userRoleIds.includes(id))
      .map((id) => idToName.get(id)!)
      .filter(Boolean);
    expect(principalRoleNames).toEqual(expectedPrincipalNames);
  });
});
