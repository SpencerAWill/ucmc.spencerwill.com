/**
 * Action implementations for the RBAC management server fns. Follows
 * the shell + .server.ts split — the shell in `./rbac-fns.ts` loads
 * this via dynamic imports inside its createServerFn handlers.
 */
import { count, eq, inArray, max } from "drizzle-orm";

import { invalidateAnonymousPermissionsCache } from "#/server/auth/principal.server";
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { getDb, schema } from "#/server/db";

// ── constants ──────────────────────────────────────────────────────────

export const PROTECTED_ROLE_IDS = new Set([
  "role_system_admin",
  "role_member",
  "role_anonymous",
]);

const SYSTEM_ADMIN_ROLE_ID = "role_system_admin";
const ANONYMOUS_ROLE_ID = "role_anonymous";
const MEMBER_ROLE_ID = "role_member";

// ── types ──────────────────────────────────────────────────────────────

export interface RoleWithPermissions {
  id: string;
  name: string;
  description: string | null;
  isProtected: boolean;
  permissionIds: string[];
  memberCount: number;
  position: number;
}

export interface RoleDetail extends RoleWithPermissions {
  members: { userId: string; email: string; preferredName: string | null }[];
}

export interface PermissionSummary {
  id: string;
  name: string;
  description: string | null;
}

// ── auth helpers ───────────────────────────────────────────────────────

async function requireRolesManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("roles:manage")) {
    throw new Error("Forbidden: missing roles:manage");
  }
  return principal;
}

async function requireRolesAssigner(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("roles:assign")) {
    throw new Error("Forbidden: missing roles:assign");
  }
  return principal;
}

// ── role queries ───────────────────────────────────────────────────────

export async function listRolesDetailedAction(): Promise<
  RoleWithPermissions[]
> {
  await requireRolesManager();
  const db = getDb();

  const roles = await db.query.roles.findMany({
    orderBy: (roles, { asc }) => [asc(roles.position), asc(roles.name)],
  });

  // Batch-fetch permission grants for all roles.
  const permGrants = await db
    .select({
      roleId: schema.rolePermissions.roleId,
      permissionId: schema.rolePermissions.permissionId,
    })
    .from(schema.rolePermissions);

  const permsByRole = new Map<string, string[]>();
  for (const g of permGrants) {
    const list = permsByRole.get(g.roleId) ?? [];
    list.push(g.permissionId);
    permsByRole.set(g.roleId, list);
  }

  // Batch count members per role.
  const memberCounts = await db
    .select({
      roleId: schema.userRoles.roleId,
      count: count(),
    })
    .from(schema.userRoles)
    .groupBy(schema.userRoles.roleId);

  const countByRole = new Map<string, number>();
  for (const mc of memberCounts) {
    countByRole.set(mc.roleId, mc.count);
  }

  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isProtected: PROTECTED_ROLE_IDS.has(r.id),
    permissionIds: permsByRole.get(r.id) ?? [],
    memberCount: countByRole.get(r.id) ?? 0,
    position: r.position,
  }));
}

export async function getRoleAction(roleId: string): Promise<RoleDetail> {
  await requireRolesManager();
  const db = getDb();

  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.id, roleId),
  });
  if (!role) {
    throw new Error("Role not found");
  }

  const permGrants = await db
    .select({ permissionId: schema.rolePermissions.permissionId })
    .from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, roleId));

  // Load members with this role (join through user_roles → users → profiles).
  const memberRows = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      preferredName: schema.profiles.preferredName,
    })
    .from(schema.userRoles)
    .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .where(eq(schema.userRoles.roleId, roleId));

  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isProtected: PROTECTED_ROLE_IDS.has(role.id),
    permissionIds: permGrants.map((g) => g.permissionId),
    memberCount: memberRows.length,
    position: role.position,
    members: memberRows.map((m) => ({
      userId: m.userId,
      email: m.email,
      preferredName: m.preferredName,
    })),
  };
}

// ── role mutations ─────────────────────────────────────────────────────

export async function createRoleAction(input: {
  name: string;
  description?: string;
}): Promise<{ roleId: string }> {
  await requireRolesManager();
  const db = getDb();

  const roleId = `role_${input.name}`;

  // Check for duplicate name.
  const existing = await db.query.roles.findFirst({
    where: eq(schema.roles.name, input.name),
    columns: { id: true },
  });
  if (existing) {
    throw new Error(`Role "${input.name}" already exists`);
  }

  // New roles go after all existing ones.
  const [{ maxPos }] = await db
    .select({ maxPos: max(schema.roles.position) })
    .from(schema.roles);
  const nextPos = (maxPos ?? -1) + 1;

  await db.insert(schema.roles).values({
    id: roleId,
    name: input.name,
    description: input.description ?? null,
    position: nextPos,
  });

  return { roleId };
}

export async function updateRoleAction(input: {
  roleId: string;
  description: string | null;
}): Promise<{ ok: true }> {
  await requireRolesManager();
  const db = getDb();

  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.id, input.roleId),
    columns: { id: true },
  });
  if (!role) {
    throw new Error("Role not found");
  }

  await db
    .update(schema.roles)
    .set({ description: input.description })
    .where(eq(schema.roles.id, input.roleId));

  return { ok: true };
}

export async function deleteRoleAction(roleId: string): Promise<{ ok: true }> {
  await requireRolesManager();

  if (PROTECTED_ROLE_IDS.has(roleId)) {
    throw new Error("Cannot delete a protected role");
  }

  const db = getDb();
  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.id, roleId),
    columns: { id: true },
  });
  if (!role) {
    throw new Error("Role not found");
  }

  // Cascade deletes handle role_permissions and user_roles rows.
  await db.delete(schema.roles).where(eq(schema.roles.id, roleId));

  return { ok: true };
}

// ── permission queries ─────────────────────────────────────────────────

export async function listPermissionsAction(): Promise<PermissionSummary[]> {
  await requireRolesManager();
  const db = getDb();

  const rows = await db.query.permissions.findMany({
    orderBy: (permissions, { asc }) => [asc(permissions.name)],
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
  }));
}

// ── role <-> permission grants ─────────────────────────────────────────

export async function setRolePermissionsAction(input: {
  roleId: string;
  permissionIds: string[];
}): Promise<{ ok: true }> {
  await requireRolesManager();

  if (input.roleId === SYSTEM_ADMIN_ROLE_ID) {
    throw new Error(
      "Cannot modify system_admin permissions — system admin automatically gets all permissions",
    );
  }

  const db = getDb();

  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.id, input.roleId),
    columns: { id: true },
  });
  if (!role) {
    throw new Error("Role not found");
  }

  // Replace-all strategy: delete existing grants, insert the new set.
  await db
    .delete(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, input.roleId));

  if (input.permissionIds.length > 0) {
    await db.insert(schema.rolePermissions).values(
      input.permissionIds.map((permissionId) => ({
        roleId: input.roleId,
        permissionId,
      })),
    );
  }

  // Invalidate anonymous permissions cache if we just changed the
  // anonymous role's grants.
  if (input.roleId === ANONYMOUS_ROLE_ID) {
    await invalidateAnonymousPermissionsCache();
  }

  return { ok: true };
}

// ── user <-> role assignments ──────────────────────────────────────────

export async function getUserRolesAction(
  userId: string,
): Promise<{ roleId: string; name: string }[]> {
  await requireRolesAssigner();
  const db = getDb();

  return db
    .select({ roleId: schema.userRoles.roleId, name: schema.roles.name })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(eq(schema.userRoles.userId, userId));
}

export async function setUserRolesAction(input: {
  userId: string;
  roleIds: string[];
}): Promise<{ ok: true }> {
  const principal = await requireRolesAssigner();
  const db = getDb();

  // Validate the target user exists and is approved.
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, input.userId),
    columns: { id: true, status: true },
  });
  if (!user) {
    throw new Error("User not found");
  }

  // Anonymous role cannot be assigned to users.
  const roleIds = input.roleIds.filter((id) => id !== ANONYMOUS_ROLE_ID);

  // Approved users must always keep the member role.
  if (user.status === "approved" && !roleIds.includes(MEMBER_ROLE_ID)) {
    roleIds.push(MEMBER_ROLE_ID);
  }

  // Self-demotion guard: cannot remove system_admin from yourself.
  if (
    input.userId === principal.userId &&
    principal.roles.includes("system_admin") &&
    !roleIds.includes(SYSTEM_ADMIN_ROLE_ID)
  ) {
    throw new Error("Cannot remove system_admin from yourself");
  }

  // Validate all roleIds exist.
  if (roleIds.length > 0) {
    const existingRoles = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(inArray(schema.roles.id, roleIds));
    const existingIds = new Set(existingRoles.map((r) => r.id));
    for (const roleId of roleIds) {
      if (!existingIds.has(roleId)) {
        throw new Error(`Role "${roleId}" does not exist`);
      }
    }
  }

  // Replace-all: delete existing assignments, insert new set.
  await db
    .delete(schema.userRoles)
    .where(eq(schema.userRoles.userId, input.userId));

  if (roleIds.length > 0) {
    await db.insert(schema.userRoles).values(
      roleIds.map((roleId) => ({
        userId: input.userId,
        roleId,
      })),
    );
  }

  return { ok: true };
}

// ── role reordering ────────────────────────────────────────────────────

/**
 * Swap the position of two roles. Used by up/down arrow controls in the
 * roles management UI.
 */
export async function swapRolePositionsAction(input: {
  roleId: string;
  direction: "up" | "down";
}): Promise<{ ok: true }> {
  await requireRolesManager();
  const db = getDb();

  const roles = await db.query.roles.findMany({
    orderBy: (roles, { asc }) => [asc(roles.position), asc(roles.name)],
  });

  const idx = roles.findIndex((r) => r.id === input.roleId);
  if (idx === -1) {
    throw new Error("Role not found");
  }

  const swapIdx = input.direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= roles.length) {
    return { ok: true }; // Already at boundary, no-op.
  }

  const current = roles[idx];
  const neighbor = roles[swapIdx];

  // Swap positions.
  await db
    .update(schema.roles)
    .set({ position: neighbor.position })
    .where(eq(schema.roles.id, current.id));
  await db
    .update(schema.roles)
    .set({ position: current.position })
    .where(eq(schema.roles.id, neighbor.id));

  return { ok: true };
}
