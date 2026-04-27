import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

// Cookie helpers need an active H3 event context — stub them out since
// loadPrincipal doesn't touch cookies directly but some transitive
// imports may pull them in.
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: () => undefined,
  setCookie: () => {},
  deleteCookie: () => {},
  getRequestHeader: () => undefined,
}));

vi.mock("#/server/rate-limit.server", () => ({
  checkAuthRateLimitByIp: async () => true,
  checkAuthRateLimitByEmail: async () => true,
}));

const { loadPrincipal } = await import("#/server/auth/principal.server");

async function seedUser(email: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  await getDb().insert(schema.users).values({
    id,
    email,
    status: "approved",
  });
  await getDb().insert(schema.profiles).values({
    userId: id,
    fullName: "Test User",
    preferredName: "Test",
    mNumber: "",
    phone: "+15135551212",
    emergencyContactName: "EC",
    emergencyContactPhone: "+15135551213",
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

beforeEach(async () => {
  const db = getDb();
  await db.delete(schema.userRoles);
  await db.delete(schema.rolePermissions);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
  // Clean up any test-only permissions from previous runs.
  await db
    .delete(schema.permissions)
    .where(eq(schema.permissions.id, "perm_test_only"));

  // Re-seed the default role_permissions that the migration creates,
  // since we wipe them above.
  await db
    .insert(schema.rolePermissions)
    .values([
      { roleId: "role_system_admin", permissionId: "perm_roles_manage" },
      { roleId: "role_system_admin", permissionId: "perm_roles_assign" },
      {
        roleId: "role_system_admin",
        permissionId: "perm_registrations_approve",
      },
    ])
    .onConflictDoNothing();
});

describe("loadPrincipal", () => {
  it("returns null for a non-existent user", async () => {
    const result = await loadPrincipal("nonexistent");
    expect(result).toBeNull();
  });

  it("returns principal with roles and permissions", async () => {
    const userId = await seedUser("member@example.com");
    await assignRole(userId, "role_member");

    const principal = await loadPrincipal(userId);

    expect(principal).not.toBeNull();
    expect(principal!.email).toBe("member@example.com");
    expect(principal!.roles).toEqual(["member"]);
    expect(principal!.permissions).toEqual([]);
    expect(principal!.hasProfile).toBe(true);
  });

  it("system_admin automatically gets ALL permissions, including unlinked ones", async () => {
    const userId = await seedUser("admin@example.com");
    await assignRole(userId, "role_system_admin");

    // Add a brand-new permission that is NOT linked to system_admin
    // via role_permissions — the invariant should still include it.
    const db = getDb();
    await db
      .insert(schema.permissions)
      .values({
        id: "perm_test_only",
        name: "test:only",
        description: "Permission with no role_permissions row for admin",
      })
      .onConflictDoNothing();

    const principal = await loadPrincipal(userId);

    expect(principal).not.toBeNull();
    expect(principal!.roles).toContain("system_admin");
    // Should include the standard three AND the unlinked test permission.
    expect(principal!.permissions).toContain("roles:manage");
    expect(principal!.permissions).toContain("roles:assign");
    expect(principal!.permissions).toContain("registrations:approve");
    expect(principal!.permissions).toContain("test:only");
  });

  it("regular user does NOT get unlinked permissions", async () => {
    const userId = await seedUser("regular@example.com");
    await assignRole(userId, "role_member");

    // Add a permission not linked to the member role.
    const db = getDb();
    await db
      .insert(schema.permissions)
      .values({
        id: "perm_test_only",
        name: "test:only",
        description: "Not linked to member",
      })
      .onConflictDoNothing();

    const principal = await loadPrincipal(userId);

    expect(principal).not.toBeNull();
    expect(principal!.roles).toEqual(["member"]);
    expect(principal!.permissions).not.toContain("test:only");
  });
});
