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
  listRolesDetailedAction,
  getRoleAction,
  createRoleAction,
  updateRoleAction,
  deleteRoleAction,
  listPermissionsAction,
  setRolePermissionsAction,
  getUserRolesAction,
  setUserRolesAction,
  reorderRolesAction,
  PROTECTED_ROLE_IDS,
} = await import("#/features/members/server/rbac-actions.server");
const { openSession } = await import("#/server/auth/session.server");
const { getKv } = await import("#/server/kv");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(
  email: string,
  opts?: { status?: schema.UserStatus },
): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status: opts?.status ?? "approved",
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

async function assignRole(userId: string, roleId: string): Promise<void> {
  await getDb()
    .insert(schema.userRoles)
    .values({ userId, roleId })
    .onConflictDoNothing();
}

/** Sign in as the given user so server actions see them as the principal. */
async function signInAs(userId: string): Promise<void> {
  cookieJar.clear();
  await openSession(userId);
}

// ── setup ──────────────────────────────────────────────────────────────

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.userRoles);
  await db.delete(schema.rolePermissions);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
  // Remove any test-created roles (keep seeded ones).
  for (const id of [
    "role_test_custom",
    "role_another",
    "role_test_trip_leader",
  ]) {
    await db.delete(schema.roles).where(eq(schema.roles.id, id));
  }
  // Remove test-only permissions.
  await db
    .delete(schema.permissions)
    .where(eq(schema.permissions.id, "perm_test_only"));

  // Re-seed role_permissions for system_admin.
  await db
    .insert(schema.rolePermissions)
    .values([
      { roleId: "role_system_admin", permissionId: "perm_roles_manage" },
      { roleId: "role_system_admin", permissionId: "perm_roles_assign" },
      { roleId: "role_system_admin", permissionId: "perm_members_manage" },
    ])
    .onConflictDoNothing();
});

// ── helpers to get a signed-in admin / regular user ────────────────────

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

// ── tests ──────────────────────────────────────────────────────────────

describe("authorization", () => {
  it("rejects unauthenticated callers", async () => {
    cookieJar.clear();
    await expect(listRolesDetailedAction()).rejects.toThrow("Not signed in");
  });

  it("rejects callers without roles:manage for role queries", async () => {
    await signInAsMember();
    await expect(listRolesDetailedAction()).rejects.toThrow(
      "Forbidden: missing roles:manage",
    );
  });

  it("rejects callers without roles:assign for user role operations", async () => {
    await signInAsMember();
    await expect(getUserRolesAction("some-user")).rejects.toThrow(
      "Forbidden: missing roles:assign",
    );
  });
});

describe("listRolesDetailedAction", () => {
  it("returns seeded roles with member counts and protection flags", async () => {
    await signInAsAdmin();
    const memberId = await seedUser("user@example.com");
    await assignRole(memberId, "role_member");

    const roles = await listRolesDetailedAction();

    expect(roles.length).toBeGreaterThanOrEqual(3); // system_admin, member, anonymous
    const sysAdmin = roles.find((r) => r.name === "system_admin");
    expect(sysAdmin).toBeDefined();
    expect(sysAdmin!.isProtected).toBe(true);
    expect(sysAdmin!.memberCount).toBe(1); // the admin we signed in as

    const member = roles.find((r) => r.name === "member");
    expect(member).toBeDefined();
    expect(member!.isProtected).toBe(true);
    expect(member!.memberCount).toBe(1); // the regular user

    const anon = roles.find((r) => r.name === "anonymous");
    expect(anon).toBeDefined();
    expect(anon!.isProtected).toBe(true);
    expect(anon!.memberCount).toBe(0);
  });
});

describe("createRoleAction", () => {
  it("creates a new role and returns its ID", async () => {
    await signInAsAdmin();
    const { roleId } = await createRoleAction({
      name: "test_custom",
      displayName: "Test Custom",
      description: "A test role",
    });
    expect(roleId).toBe("role_test_custom");

    const role = await getDb().query.roles.findFirst({
      where: eq(schema.roles.id, roleId),
    });
    expect(role).toBeDefined();
    expect(role!.name).toBe("test_custom");
    expect(role!.displayName).toBe("Test Custom");
    expect(role!.description).toBe("A test role");
    expect(role!.isOfficer).toBe(false);
  });

  it("persists isOfficer when set", async () => {
    await signInAsAdmin();
    const { roleId } = await createRoleAction({
      name: "test_trip_leader",
      displayName: "Trip Leader",
      isOfficer: true,
    });

    const role = await getDb().query.roles.findFirst({
      where: eq(schema.roles.id, roleId),
    });
    expect(role!.isOfficer).toBe(true);
  });

  it("rejects duplicate role names", async () => {
    await signInAsAdmin();
    await createRoleAction({ name: "test_custom", displayName: "Test Custom" });
    await expect(
      createRoleAction({ name: "test_custom", displayName: "Test Custom" }),
    ).rejects.toThrow('Role "test_custom" already exists');
  });
});

describe("updateRoleAction", () => {
  it("updates description of a role", async () => {
    await signInAsAdmin();
    const { roleId } = await createRoleAction({
      name: "test_custom",
      displayName: "Test Custom",
    });

    await updateRoleAction({ roleId, description: "Updated desc" });

    const role = await getDb().query.roles.findFirst({
      where: eq(schema.roles.id, roleId),
    });
    expect(role!.description).toBe("Updated desc");
  });

  it("throws for nonexistent role", async () => {
    await signInAsAdmin();
    await expect(
      updateRoleAction({ roleId: "role_fake", description: "x" }),
    ).rejects.toThrow("Role not found");
  });

  it("updates displayName without touching other fields", async () => {
    await signInAsAdmin();
    const { roleId } = await createRoleAction({
      name: "test_trip_leader",
      displayName: "Trip Leader",
      description: "Leads trips",
    });
    await updateRoleAction({ roleId, displayName: "Trip Lead" });

    const role = await getDb().query.roles.findFirst({
      where: eq(schema.roles.id, roleId),
    });
    expect(role!.displayName).toBe("Trip Lead");
    expect(role!.description).toBe("Leads trips");
    expect(role!.isOfficer).toBe(false);
  });

  it("toggles isOfficer", async () => {
    await signInAsAdmin();
    const { roleId } = await createRoleAction({
      name: "test_trip_leader",
      displayName: "Trip Leader",
    });

    await updateRoleAction({ roleId, isOfficer: true });
    let role = await getDb().query.roles.findFirst({
      where: eq(schema.roles.id, roleId),
    });
    expect(role!.isOfficer).toBe(true);

    await updateRoleAction({ roleId, isOfficer: false });
    role = await getDb().query.roles.findFirst({
      where: eq(schema.roles.id, roleId),
    });
    expect(role!.isOfficer).toBe(false);
  });

  it("rejects flagging system_admin as an officer", async () => {
    await signInAsAdmin();
    await expect(
      updateRoleAction({ roleId: "role_system_admin", isOfficer: true }),
    ).rejects.toThrow(/Cannot flag system_admin/);
  });

  it("rejects renaming system_admin", async () => {
    await signInAsAdmin();
    await expect(
      updateRoleAction({
        roleId: "role_system_admin",
        displayName: "Owner",
      }),
    ).rejects.toThrow(/Cannot change the system_admin display name/);
  });

  it("rejects flagging anonymous as an officer", async () => {
    await signInAsAdmin();
    await expect(
      updateRoleAction({ roleId: "role_anonymous", isOfficer: true }),
    ).rejects.toThrow(/Cannot flag the anonymous role/);
  });

  it("emits a role.updated audit row capturing only the fields that changed", async () => {
    const adminId = await signInAsAdmin();
    const { roleId } = await createRoleAction({
      name: "test_trip_leader",
      displayName: "Trip Leader",
    });

    // Reset the audit log so the assertion only sees this update's row.
    await getDb().delete(schema.auditLog);

    await updateRoleAction({
      roleId,
      displayName: "Trip Lead",
      isOfficer: true,
    });

    const rows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "role.updated"));
    expect(rows).toHaveLength(1);
    expect(rows[0].actorUserId).toBe(adminId);
    expect(rows[0].targetType).toBe("role");
    expect(rows[0].targetId).toBe(roleId);
    const meta = JSON.parse(rows[0].metadataJson ?? "{}") as {
      name: string;
      changed: Record<string, { from: unknown; to: unknown }>;
    };
    expect(meta.name).toBe("test_trip_leader");
    expect(meta.changed).toEqual({
      displayName: { from: "Trip Leader", to: "Trip Lead" },
      isOfficer: { from: false, to: true },
    });
  });

  it("DB-layer trigger blocks empty display_name writes (defense in depth)", async () => {
    // Bypass the action's validation by going straight at the table.
    // The migration 0040 trigger is the last line of defense if a
    // future seed / fixture / D1 console session forgets to validate.
    // Drizzle wraps D1 errors in a generic "Failed query" prefix, so
    // assert on the underlying message via error.cause instead of the
    // top-level Error.message.
    const db = getDb();
    let insertErr: unknown;
    try {
      await db.insert(schema.roles).values({
        id: "role_empty_label",
        name: "empty_label",
        displayName: "",
      });
    } catch (e) {
      insertErr = e;
    }
    expect(insertErr).toBeInstanceOf(Error);
    expect(String((insertErr as Error).cause ?? insertErr)).toMatch(
      /display_name must not be empty/,
    );
    // And the row really wasn't inserted.
    expect(
      await db.query.roles.findFirst({
        where: eq(schema.roles.id, "role_empty_label"),
      }),
    ).toBeUndefined();

    // Update path: existing row gets blanked.
    await db.insert(schema.roles).values({
      id: "role_has_label",
      name: "has_label",
      displayName: "Has Label",
    });
    let updateErr: unknown;
    try {
      await db
        .update(schema.roles)
        .set({ displayName: "" })
        .where(eq(schema.roles.id, "role_has_label"));
    } catch (e) {
      updateErr = e;
    }
    expect(updateErr).toBeInstanceOf(Error);
    expect(String((updateErr as Error).cause ?? updateErr)).toMatch(
      /display_name must not be empty/,
    );
    const after = await db.query.roles.findFirst({
      where: eq(schema.roles.id, "role_has_label"),
    });
    expect(after?.displayName).toBe("Has Label");
    // Cleanup so other tests in this file don't trip on the leftover row.
    await db.delete(schema.roles).where(eq(schema.roles.id, "role_has_label"));
  });

  it("does not emit an audit row when the patch is a no-op", async () => {
    await signInAsAdmin();
    const { roleId } = await createRoleAction({
      name: "test_trip_leader",
      displayName: "Trip Leader",
    });
    await getDb().delete(schema.auditLog);

    // Re-asserting the same values produces no diff.
    await updateRoleAction({ roleId, displayName: "Trip Leader" });

    const rows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "role.updated"));
    expect(rows).toHaveLength(0);
  });
});

describe("deleteRoleAction", () => {
  it("deletes a non-protected role", async () => {
    await signInAsAdmin();
    const { roleId } = await createRoleAction({
      name: "test_custom",
      displayName: "Test Custom",
    });

    await deleteRoleAction(roleId);

    const role = await getDb().query.roles.findFirst({
      where: eq(schema.roles.id, roleId),
    });
    expect(role).toBeUndefined();
  });

  it("throws for protected roles", async () => {
    await signInAsAdmin();
    for (const id of PROTECTED_ROLE_IDS) {
      await expect(deleteRoleAction(id)).rejects.toThrow(
        "Cannot delete a protected role",
      );
    }
  });

  it("throws for nonexistent role", async () => {
    await signInAsAdmin();
    await expect(deleteRoleAction("role_fake")).rejects.toThrow(
      "Role not found",
    );
  });
});

describe("getRoleAction", () => {
  it("returns role detail with members", async () => {
    const adminId = await signInAsAdmin();

    const detail = await getRoleAction("role_system_admin");

    expect(detail.name).toBe("system_admin");
    expect(detail.isProtected).toBe(true);
    expect(detail.members.length).toBe(1);
    expect(detail.members[0].userId).toBe(adminId);
  });
});

describe("listPermissionsAction", () => {
  it("returns all seeded permissions", async () => {
    await signInAsAdmin();
    const perms = await listPermissionsAction();

    expect(perms.length).toBeGreaterThanOrEqual(3);
    const names = perms.map((p) => p.name);
    expect(names).toContain("roles:manage");
    expect(names).toContain("roles:assign");
    expect(names).toContain("members:manage");
  });
});

describe("setRolePermissionsAction", () => {
  it("replaces permission grants for a role", async () => {
    await signInAsAdmin();
    const { roleId } = await createRoleAction({
      name: "test_custom",
      displayName: "Test Custom",
    });

    // Grant one permission.
    await setRolePermissionsAction({
      roleId,
      permissionIds: ["perm_members_manage"],
    });

    let grants = await getDb()
      .select({ permissionId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleId));
    expect(grants.map((g) => g.permissionId)).toEqual(["perm_members_manage"]);

    // Replace with a different set.
    await setRolePermissionsAction({
      roleId,
      permissionIds: ["perm_roles_assign", "perm_roles_manage"],
    });

    grants = await getDb()
      .select({ permissionId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleId));
    expect(grants.map((g) => g.permissionId).sort()).toEqual([
      "perm_roles_assign",
      "perm_roles_manage",
    ]);
  });

  it("blocks modification of system_admin permissions", async () => {
    await signInAsAdmin();
    await expect(
      setRolePermissionsAction({
        roleId: "role_system_admin",
        permissionIds: [],
      }),
    ).rejects.toThrow("Cannot modify system_admin permissions");
  });

  it("clears grants when given an empty array", async () => {
    await signInAsAdmin();
    const { roleId } = await createRoleAction({
      name: "test_custom",
      displayName: "Test Custom",
    });
    await setRolePermissionsAction({
      roleId,
      permissionIds: ["perm_roles_manage"],
    });

    await setRolePermissionsAction({ roleId, permissionIds: [] });

    const grants = await getDb()
      .select()
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleId));
    expect(grants).toEqual([]);
  });

  it("invalidates the anonymous permissions cache when anonymous is touched", async () => {
    await signInAsAdmin();
    const kv = getKv();
    await kv.put("anonymous:permissions", JSON.stringify(["roles:manage"]));
    expect(await kv.get("anonymous:permissions")).not.toBeNull();

    await setRolePermissionsAction({
      roleId: "role_anonymous",
      permissionIds: [],
    });

    expect(await kv.get("anonymous:permissions")).toBeNull();
  });
});

describe("getUserRolesAction / setUserRolesAction", () => {
  it("gets and sets user roles", async () => {
    await signInAsAdmin();
    const memberId = await seedUser("target@example.com");
    await assignRole(memberId, "role_member");

    // Check current roles.
    const before = await getUserRolesAction(memberId);
    expect(before.map((r) => r.name)).toEqual(["member"]);

    // Create a custom role and assign it.
    await createRoleAction({ name: "test_custom", displayName: "Test Custom" });
    await setUserRolesAction({
      userId: memberId,
      roleIds: ["role_member", "role_test_custom"],
    });

    const after = await getUserRolesAction(memberId);
    const names = after.map((r) => r.name).sort();
    expect(names).toEqual(["member", "test_custom"]);
  });

  it("always includes member role for approved users", async () => {
    await signInAsAdmin();
    const memberId = await seedUser("target@example.com");

    // Try to assign only system_admin (no member).
    await setUserRolesAction({
      userId: memberId,
      roleIds: ["role_system_admin"],
    });

    const roles = await getUserRolesAction(memberId);
    const names = roles.map((r) => r.name).sort();
    expect(names).toContain("member");
    expect(names).toContain("system_admin");
  });

  it("blocks self-demotion from system_admin", async () => {
    const adminId = await signInAsAdmin();
    await assignRole(adminId, "role_member");

    await expect(
      setUserRolesAction({
        userId: adminId,
        roleIds: ["role_member"],
      }),
    ).rejects.toThrow("Cannot remove system_admin from yourself");
  });

  it("filters out anonymous role from user assignments", async () => {
    await signInAsAdmin();
    const memberId = await seedUser("target@example.com");

    await setUserRolesAction({
      userId: memberId,
      roleIds: ["role_member", "role_anonymous"],
    });

    const roles = await getUserRolesAction(memberId);
    const names = roles.map((r) => r.name);
    expect(names).not.toContain("anonymous");
    expect(names).toContain("member");
  });

  it("throws for nonexistent role IDs", async () => {
    await signInAsAdmin();
    const memberId = await seedUser("target@example.com");

    await expect(
      setUserRolesAction({
        userId: memberId,
        roleIds: ["role_member", "role_does_not_exist"],
      }),
    ).rejects.toThrow('Role "role_does_not_exist" does not exist');
  });
});

describe("reorderRolesAction", () => {
  it("writes positions in the supplied order", async () => {
    await signInAsAdmin();
    await createRoleAction({ name: "test_custom", displayName: "Test Custom" });
    await createRoleAction({ name: "another", displayName: "Another" });

    const before = await listRolesDetailedAction();
    const ids = before.map((r) => r.id);

    // Reverse the order.
    const reversed = [...ids].reverse();
    await reorderRolesAction({ orderedRoleIds: reversed });

    const after = await listRolesDetailedAction();
    expect(after.map((r) => r.id)).toEqual(reversed);
    after.forEach((r, i) => {
      expect(r.position).toBe(i);
    });
  });

  it("rejects an order list with extra ids", async () => {
    await signInAsAdmin();
    const roles = await listRolesDetailedAction();
    const ids = roles.map((r) => r.id);
    await expect(
      reorderRolesAction({ orderedRoleIds: [...ids, "role_phantom"] }),
    ).rejects.toThrow(/does not match role count/);
  });

  it("rejects an order list missing an existing role", async () => {
    await signInAsAdmin();
    const roles = await listRolesDetailedAction();
    const truncated = roles.slice(1).map((r) => r.id);
    await expect(
      reorderRolesAction({ orderedRoleIds: truncated }),
    ).rejects.toThrow(/does not match role count/);
  });

  it("rejects duplicate role ids in the order list", async () => {
    await signInAsAdmin();
    const roles = await listRolesDetailedAction();
    const ids = roles.map((r) => r.id);
    const dup = [ids[0], ids[0], ...ids.slice(1, -1)];
    await expect(reorderRolesAction({ orderedRoleIds: dup })).rejects.toThrow(
      /Duplicate role id/,
    );
  });
});
