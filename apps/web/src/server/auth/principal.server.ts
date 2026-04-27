/**
 * The `Principal` is the server's cached view of who's signed in for a
 * given request: user identity + approval status + RBAC. Built by joining
 * `users`, `profiles`, `user_roles`, and `role_permissions` once per
 * request and handed to loaders/guards/server-fns.
 */
import { eq, inArray } from "drizzle-orm";

import { getDb, schema } from "#/server/db";
import { getKv } from "#/server/kv";

export interface Principal {
  userId: string;
  email: string;
  status: schema.UserStatus;
  hasProfile: boolean;
  roles: string[];
  permissions: string[];
  /** Per-role permission breakdown so the view-mode emulator can show
   *  what a specific role grants without an extra fetch. */
  rolePermissionMap: Record<string, string[]>;
}

export async function loadPrincipal(userId: string): Promise<Principal | null> {
  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
  });
  if (!user) {
    return null;
  }

  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, userId),
    columns: { userId: true },
  });

  const userRoleRows = await db
    .select({ roleId: schema.userRoles.roleId, name: schema.roles.name })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(eq(schema.userRoles.userId, userId));

  const roleIds = userRoleRows.map((r) => r.roleId);
  const isSystemAdmin = userRoleRows.some((r) => r.name === "system_admin");

  // Build the aggregated permission set and the per-role breakdown.
  const rolePermissionMap: Record<string, string[]> = {};
  let permissions: string[] = [];

  if (isSystemAdmin) {
    // System admin always has every permission, including ones added
    // after the role was created. This is the canonical enforcement
    // point — no need to maintain role_permissions rows for system_admin.
    const allPerms = await db.query.permissions.findMany({
      columns: { name: true },
    });
    permissions = allPerms.map((p) => p.name);
    // system_admin gets all; other roles still get their individual breakdowns.
    rolePermissionMap["system_admin"] = permissions;
  }

  if (roleIds.length > 0) {
    const rows = await db
      .select({
        roleId: schema.rolePermissions.roleId,
        permName: schema.permissions.name,
      })
      .from(schema.rolePermissions)
      .innerJoin(
        schema.permissions,
        eq(schema.permissions.id, schema.rolePermissions.permissionId),
      )
      .where(inArray(schema.rolePermissions.roleId, roleIds));

    // Build per-role map using role names.
    const roleIdToName = new Map(userRoleRows.map((r) => [r.roleId, r.name]));
    for (const row of rows) {
      const roleName = roleIdToName.get(row.roleId);
      if (roleName && roleName !== "system_admin") {
        const list = rolePermissionMap[roleName] ?? [];
        list.push(row.permName);
        rolePermissionMap[roleName] = list;
      }
    }

    // For non-admin users, build the aggregated set from the per-role data.
    if (!isSystemAdmin) {
      permissions = Array.from(new Set(rows.map((r) => r.permName)));
    }
  }

  // Ensure every role has an entry (even if empty).
  for (const r of userRoleRows) {
    if (!(r.name in rolePermissionMap)) {
      rolePermissionMap[r.name] = [];
    }
  }

  return {
    userId: user.id,
    email: user.email,
    status: user.status,
    hasProfile: Boolean(profile),
    roles: userRoleRows.map((r) => r.name),
    permissions,
    rolePermissionMap,
  };
}

// ── anonymous permissions ──────────────────────────────────────────────

const ANONYMOUS_ROLE_ID = "role_anonymous";
const ANONYMOUS_CACHE_KEY = "anonymous:permissions";
const ANONYMOUS_CACHE_TTL = 300; // 5 minutes

/**
 * Load the permissions granted to the `anonymous` pseudo-role. Result is
 * cached in KV for 5 minutes so unauthenticated page loads are fast.
 * Call `invalidateAnonymousPermissionsCache()` after editing the role's
 * permission grants.
 */
export async function loadAnonymousPermissions(): Promise<string[]> {
  const kv = getKv();
  const cached = await kv.get(ANONYMOUS_CACHE_KEY);
  if (cached !== null) {
    return JSON.parse(cached) as string[];
  }

  const db = getDb();
  const rows = await db
    .select({ name: schema.permissions.name })
    .from(schema.rolePermissions)
    .innerJoin(
      schema.permissions,
      eq(schema.permissions.id, schema.rolePermissions.permissionId),
    )
    .where(eq(schema.rolePermissions.roleId, ANONYMOUS_ROLE_ID));

  const perms = rows.map((r) => r.name);
  await kv.put(ANONYMOUS_CACHE_KEY, JSON.stringify(perms), {
    expirationTtl: ANONYMOUS_CACHE_TTL,
  });
  return perms;
}

/** Delete the KV cache so the next call to `loadAnonymousPermissions`
 *  hits D1. Called after `setRolePermissionsFn` touches the anonymous role. */
export async function invalidateAnonymousPermissionsCache(): Promise<void> {
  await getKv().delete(ANONYMOUS_CACHE_KEY);
}
