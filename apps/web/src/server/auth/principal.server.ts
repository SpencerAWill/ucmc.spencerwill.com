/**
 * The `Principal` is the server's cached view of who's signed in for a
 * given request: user identity + approval status + RBAC. Built by joining
 * `users`, `profiles`, `user_roles`, and `role_permissions` once per
 * request and handed to loaders/guards/server-fns.
 */
import { asc, desc, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "#/server/db";
import { getKv } from "#/server/kv";

export interface Principal {
  userId: string;
  /**
   * The user's primary email — the address used for outbound mail,
   * the WebAuthn RP `userName`, audit snapshots, and member-directory
   * listings. Always present; an account without a primary email is
   * a data-model violation.
   */
  primaryEmail: string;
  /**
   * Every verified email attached to the account, primary first then
   * the rest in insertion order. Sign-in works against any address in
   * this list. Always non-empty (length ≥ 1).
   */
  emails: string[];
  status: schema.UserStatus;
  hasProfile: boolean;
  avatarKey: string | null;
  roles: string[];
  permissions: string[];
  /** Per-role permission breakdown so the view-mode emulator can show
   *  what a specific role grants without an extra fetch. */
  rolePermissionMap: Record<string, string[]>;
}

export async function loadPrincipal(userId: string): Promise<Principal | null> {
  const db = getDb();

  // The user row, profile, email list, and role list all key on
  // `userId` only — no dependency between them. Bundle them in a
  // `db.batch` so all four reads ride on a single D1 HTTP request
  // (`Promise.all` would still issue four separate calls).
  //
  // Free correctness bonus: `db.batch` runs the four reads in one
  // D1 transaction, so they see a consistent point-in-time snapshot.
  // `Promise.all` would let a concurrent write (e.g. an admin
  // assigning a role) split rows between the userRoles and
  // rolePermissions reads.
  //
  // Primary first, then non-primary in insertion order, on the email
  // ordering at the DB layer keeps the resulting `emails` array
  // stable across requests so consumers can rely on the shape. `id`
  // is the final tiebreaker — `created_at` is millisecond-resolution
  // and can collide on `db.batch`-inserted rows or fast back-to-back
  // inserts; the PK gives a deterministic total order.
  const [userRows, profileRows, emailRows, userRoleRows] = await db.batch([
    db
      .select({ id: schema.users.id, status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1),
    db
      .select({ avatarKey: schema.profiles.avatarKey })
      .from(schema.profiles)
      .where(eq(schema.profiles.userId, userId))
      .limit(1),
    db
      .select({
        email: schema.userEmails.email,
        isPrimary: schema.userEmails.isPrimary,
      })
      .from(schema.userEmails)
      .where(eq(schema.userEmails.userId, userId))
      .orderBy(
        desc(schema.userEmails.isPrimary),
        asc(schema.userEmails.createdAt),
        asc(schema.userEmails.id),
      ),
    db
      .select({ roleId: schema.userRoles.roleId, name: schema.roles.name })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(eq(schema.userRoles.userId, userId)),
  ]);
  if (userRows.length === 0) {
    return null;
  }
  const user = userRows[0];
  const profile = profileRows[0] as (typeof profileRows)[number] | undefined;

  const primaryRow = emailRows[0]?.isPrimary ? emailRows[0] : undefined;
  if (!primaryRow) {
    // Hard invariant violation: a user row exists with no primary
    // email row. Surface loudly so the bug is caught instead of
    // silently producing a Principal with `primaryEmail = ""`.
    throw new Error(`User ${userId} has no primary email row`);
  }
  const emails = emailRows.map((r) => r.email);

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
    primaryEmail: primaryRow.email,
    emails,
    status: user.status,
    hasProfile: Boolean(profile),
    avatarKey: profile?.avatarKey ?? null,
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
