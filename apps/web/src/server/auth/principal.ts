/**
 * The `Principal` is the server's cached view of who's signed in for a
 * given request: user identity + approval status + RBAC. Built by joining
 * `users`, `profiles`, `user_roles`, and `role_permissions` once per
 * request and handed to loaders/guards/server-fns.
 */
import { eq, inArray } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export interface Principal {
  userId: string;
  email: string;
  status: schema.UserStatus;
  hasProfile: boolean;
  roles: string[];
  permissions: string[];
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
  let permissions: string[] = [];
  if (roleIds.length > 0) {
    const rows = await db
      .select({ name: schema.permissions.name })
      .from(schema.rolePermissions)
      .innerJoin(
        schema.permissions,
        eq(schema.permissions.id, schema.rolePermissions.permissionId),
      )
      .where(inArray(schema.rolePermissions.roleId, roleIds));
    permissions = Array.from(new Set(rows.map((r) => r.name)));
  }

  return {
    userId: user.id,
    email: user.email,
    status: user.status,
    hasProfile: Boolean(profile),
    roles: userRoleRows.map((r) => r.name),
    permissions,
  };
}
