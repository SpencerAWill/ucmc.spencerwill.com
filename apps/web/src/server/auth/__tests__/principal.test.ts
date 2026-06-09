import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

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

const {
  loadPrincipal,
  loadAnonymousPermissions,
  invalidateAnonymousPermissionsCache,
} = await import("#/server/auth/principal.server");

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
  await getDb().insert(schema.profiles).values({
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
      { roleId: "role_system_admin", permissionId: "perm_members_manage" },
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
    expect(principal!.primaryEmail).toBe("member@example.com");
    expect(principal!.emails).toEqual(["member@example.com"]);
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
    expect(principal!.permissions).toContain("members:manage");
    expect(principal!.permissions).toContain("test:only");
  });

  it("system_admin's rolePermissionMap is keyed by role names, not permission strings", async () => {
    // Regression for the view-as emulator showing entries like
    // "members:manage" / "roles:assign" instead of role names. The
    // sys-admin branch builds rolePermissionMap from a joined SELECT
    // where both sides project `name` (`roles.name` + `permissions.name`);
    // without explicit SQL aliases, drizzle's `db.batch` result mapping
    // collapses both into a single object key and the second value
    // overwrites the first, keying the map by permission strings.
    const userId = await seedUser("admin-keys@example.com");
    await assignRole(userId, "role_system_admin");

    const principal = await loadPrincipal(userId);

    expect(principal).not.toBeNull();
    const keys = Object.keys(principal!.rolePermissionMap);
    expect(keys.length).toBeGreaterThan(0);
    // Role names are lowercase identifier slugs (`member`, `president`,
    // …); permission names follow `<feature>:<action>` and contain `:`.
    // No key may contain `:`.
    for (const k of keys) {
      expect(k).not.toContain(":");
    }
    // The system_admin sentinel is the "actual permissions" entry the
    // view-as Select filters out before rendering.
    expect(keys).toContain("system_admin");
    // And every value is an array of permission names (or empty).
    for (const perms of Object.values(principal!.rolePermissionMap)) {
      expect(Array.isArray(perms)).toBe(true);
      for (const p of perms) {
        expect(p).toMatch(/^[a-z_]+:[a-z_]+$/);
      }
    }
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

describe("loadAnonymousPermissions", () => {
  it("returns empty array when the anonymous role has no permissions", async () => {
    // Clear KV cache so we hit DB.
    await invalidateAnonymousPermissionsCache();
    const perms = await loadAnonymousPermissions();
    expect(perms).toEqual([]);
  });

  it("returns permissions assigned to the anonymous role", async () => {
    const db = getDb();
    // Grant members:manage to anonymous for this test.
    await db
      .insert(schema.rolePermissions)
      .values({
        roleId: "role_anonymous",
        permissionId: "perm_members_manage",
      })
      .onConflictDoNothing();

    await invalidateAnonymousPermissionsCache();
    const perms = await loadAnonymousPermissions();
    expect(perms).toContain("members:manage");
  });

  it("caches results in KV so a second call skips DB", async () => {
    await invalidateAnonymousPermissionsCache();

    // First call populates the cache.
    const first = await loadAnonymousPermissions();
    expect(first).toEqual([]);

    // Insert a permission grant AFTER the cache was set.
    const db = getDb();
    await db
      .insert(schema.rolePermissions)
      .values({
        roleId: "role_anonymous",
        permissionId: "perm_roles_manage",
      })
      .onConflictDoNothing();

    // Second call should return the cached (empty) result.
    const second = await loadAnonymousPermissions();
    expect(second).toEqual([]);

    // After invalidation, the fresh data appears.
    await invalidateAnonymousPermissionsCache();
    const third = await loadAnonymousPermissions();
    expect(third).toContain("roles:manage");
  });
});
