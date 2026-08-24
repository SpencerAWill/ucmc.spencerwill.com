/**
 * Action implementations for the RBAC management server fns. Follows
 * the shell + .server.ts split — the shell in `./rbac-fns.ts` loads
 * this via dynamic imports inside its createServerFn handlers.
 */
import { and, asc, count, eq, inArray, max } from "drizzle-orm";

import {
  buildAuditEventStatement,
  buildBulkAuditEventStatement,
} from "#/server/audit/audit-log.server";
import { invalidateAnonymousPermissionsCache } from "#/server/auth/principal.server";
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { getDb, isUniqueViolation, schema } from "#/server/db";

// ── constants ──────────────────────────────────────────────────────────

export const PROTECTED_ROLE_IDS = new Set([
  "role_system_admin",
  "role_member",
  "role_anonymous",
  // Seeded officer roles (0016_officer_roles_seed.sql). Protect them
  // from deletion so an officer with `roles:manage` can't accidentally
  // drop a constitutional officer role and break the permission grants
  // that depend on it (e.g. President + Treasurer → `waivers:verify`).
  // Permission grants on these roles remain editable through the
  // admin UI; this only blocks deletion.
  "role_advisor",
  "role_president",
  "role_treasurer",
]);

const SYSTEM_ADMIN_ROLE_ID = "role_system_admin";
const ANONYMOUS_ROLE_ID = "role_anonymous";
const MEMBER_ROLE_ID = "role_member";

// ── types ──────────────────────────────────────────────────────────────

export interface RoleWithPermissions {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isProtected: boolean;
  isOfficer: boolean;
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

  // Roles, all role-permission grants, and the per-role member count
  // are independent — bundle into one `db.batch` so all three reads
  // ride on a single D1 HTTP request.
  const [roles, permGrants, memberCounts] = await db.batch([
    db
      .select()
      .from(schema.roles)
      .orderBy(asc(schema.roles.position), asc(schema.roles.name)),
    db
      .select({
        roleId: schema.rolePermissions.roleId,
        permissionId: schema.rolePermissions.permissionId,
      })
      .from(schema.rolePermissions),
    db
      .select({
        roleId: schema.userRoles.roleId,
        count: count(),
      })
      .from(schema.userRoles)
      .groupBy(schema.userRoles.roleId),
  ]);

  const permsByRole = new Map<string, string[]>();
  for (const g of permGrants) {
    const list = permsByRole.get(g.roleId) ?? [];
    list.push(g.permissionId);
    permsByRole.set(g.roleId, list);
  }

  const countByRole = new Map<string, number>();
  for (const mc of memberCounts) {
    countByRole.set(mc.roleId, mc.count);
  }

  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    displayName: r.displayName,
    description: r.description,
    isProtected: PROTECTED_ROLE_IDS.has(r.id),
    isOfficer: r.isOfficer,
    permissionIds: permsByRole.get(r.id) ?? [],
    memberCount: countByRole.get(r.id) ?? 0,
    position: r.position,
  }));
}

export async function getRoleAction(roleId: string): Promise<RoleDetail> {
  await requireRolesManager();
  const db = getDb();

  // Role row, permission grants, and member list all key on `roleId`
  // alone. Bundle into one `db.batch` so all three reads ride on a
  // single D1 HTTP request; existence is validated below before
  // returning.
  const [roleRows, permGrants, memberRows] = await db.batch([
    db.select().from(schema.roles).where(eq(schema.roles.id, roleId)).limit(1),
    db
      .select({ permissionId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleId)),
    db
      .select({
        userId: schema.users.id,
        email: schema.userEmails.email,
        preferredName: schema.profiles.preferredName,
      })
      .from(schema.userRoles)
      .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
      .innerJoin(
        schema.userEmails,
        and(
          eq(schema.userEmails.userId, schema.users.id),
          eq(schema.userEmails.isPrimary, true),
        ),
      )
      .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .where(eq(schema.userRoles.roleId, roleId)),
  ]);
  if (roleRows.length === 0) {
    throw new Error("Role not found");
  }
  const role = roleRows[0];

  return {
    id: role.id,
    name: role.name,
    displayName: role.displayName,
    description: role.description,
    isProtected: PROTECTED_ROLE_IDS.has(role.id),
    isOfficer: role.isOfficer,
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
  displayName: string;
  description?: string;
  isOfficer?: boolean;
}): Promise<{ roleId: string }> {
  const principal = await requireRolesManager();
  const db = getDb();

  const roleId = `role_${input.name}`;

  // No pre-check on the name — `roles_name_unique` is the actual race
  // boundary, so the pre-check was theatre (TOCTOU between the read
  // and the insert). Compute `nextPos` and try the insert; translate
  // the unique violation back to the user-facing error.
  const [{ maxPos }] = await db
    .select({ maxPos: max(schema.roles.position) })
    .from(schema.roles);
  const nextPos = (maxPos ?? -1) + 1;
  const isOfficer = input.isOfficer ?? false;

  try {
    // Atomic with the audit row.
    await db.batch([
      db.insert(schema.roles).values({
        id: roleId,
        name: input.name,
        displayName: input.displayName,
        description: input.description ?? null,
        position: nextPos,
        isOfficer,
      }),
      buildAuditEventStatement({
        actorUserId: principal.userId,
        action: "role.created",
        targetType: "role",
        targetId: roleId,
        metadata: {
          name: input.name,
          displayName: input.displayName,
          isOfficer,
        },
      }),
    ]);
  } catch (err) {
    if (
      isUniqueViolation(err, "roles.name") ||
      isUniqueViolation(err, "roles.id")
    ) {
      throw new Error(`Role "${input.name}" already exists`, { cause: err });
    }
    throw err;
  }

  return { roleId };
}

export async function updateRoleAction(input: {
  roleId: string;
  description?: string | null;
  displayName?: string;
  isOfficer?: boolean;
}): Promise<{ ok: true }> {
  const principal = await requireRolesManager();
  const db = getDb();

  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.id, input.roleId),
    columns: {
      id: true,
      name: true,
      displayName: true,
      description: true,
      isOfficer: true,
    },
  });
  if (!role) {
    throw new Error("Role not found");
  }

  // Constitutional-role protections. system_admin's identity is system-
  // shaped, not a public-facing label, and surfacing every system_admin
  // on the public home page would leak the role assignment. anonymous
  // has no users so officer-flagging it is a no-op at best and a
  // misleading audit row at worst — reject explicitly. Other officer
  // roles (advisor, president, treasurer) remain editable because that's
  // exactly the surface the editor exists for.
  if (input.roleId === SYSTEM_ADMIN_ROLE_ID) {
    if (
      input.displayName !== undefined &&
      input.displayName !== role.displayName
    ) {
      throw new Error("Cannot change the system_admin display name");
    }
    if (input.isOfficer === true) {
      throw new Error("Cannot flag system_admin as an officer position");
    }
  }
  if (input.roleId === ANONYMOUS_ROLE_ID && input.isOfficer === true) {
    throw new Error("Cannot flag the anonymous role as an officer position");
  }

  const patch: Partial<typeof schema.roles.$inferInsert> = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  if (
    input.description !== undefined &&
    input.description !== role.description
  ) {
    patch.description = input.description;
    changed.description = { from: role.description, to: input.description };
  }
  if (
    input.displayName !== undefined &&
    input.displayName !== role.displayName
  ) {
    patch.displayName = input.displayName;
    changed.displayName = { from: role.displayName, to: input.displayName };
  }
  if (input.isOfficer !== undefined && input.isOfficer !== role.isOfficer) {
    patch.isOfficer = input.isOfficer;
    changed.isOfficer = { from: role.isOfficer, to: input.isOfficer };
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true };
  }

  // Atomic with the audit row. `role.updated` lets us correlate
  // public-surface flips (`isOfficer`) and visible-label edits
  // (`displayName`) back to an actor — important now that toggling
  // `is_officer` directly changes what unauthenticated visitors see.
  await db.batch([
    db.update(schema.roles).set(patch).where(eq(schema.roles.id, input.roleId)),
    buildAuditEventStatement({
      actorUserId: principal.userId,
      action: "role.updated",
      targetType: "role",
      targetId: input.roleId,
      metadata: { name: role.name, changed },
    }),
  ]);

  return { ok: true };
}

export async function deleteRoleAction(roleId: string): Promise<{ ok: true }> {
  const principal = await requireRolesManager();

  if (PROTECTED_ROLE_IDS.has(roleId)) {
    throw new Error("Cannot delete a protected role");
  }

  const db = getDb();
  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.id, roleId),
    columns: { id: true, name: true },
  });
  if (!role) {
    throw new Error("Role not found");
  }

  // Cascade deletes handle role_permissions and user_roles rows.
  // Atomic with the audit row.
  await db.batch([
    db.delete(schema.roles).where(eq(schema.roles.id, roleId)),
    buildAuditEventStatement({
      actorUserId: principal.userId,
      action: "role.deleted",
      targetType: "role",
      targetId: roleId,
      metadata: { name: role.name },
    }),
  ]);

  return { ok: true };
}

// ── permission queries ─────────────────────────────────────────────────

export async function listPermissionsAction(): Promise<PermissionSummary[]> {
  await requireRolesManager();
  const db = getDb();

  const rows = await db.query.permissions.findMany({
    orderBy: (p, { asc: a }) => [a(p.name)],
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
  const principal = await requireRolesManager();

  if (input.roleId === SYSTEM_ADMIN_ROLE_ID) {
    throw new Error(
      "Cannot modify system_admin permissions — system admin automatically gets all permissions",
    );
  }

  const db = getDb();

  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.id, input.roleId),
    columns: { id: true, name: true },
  });
  if (!role) {
    throw new Error("Role not found");
  }

  // Replace-all strategy: delete existing grants, insert the new
  // set, all atomic with the audit row via D1 batch.
  const stmts = [
    db
      .delete(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, input.roleId)),
    ...(input.permissionIds.length > 0
      ? [
          db.insert(schema.rolePermissions).values(
            input.permissionIds.map((permissionId) => ({
              roleId: input.roleId,
              permissionId,
            })),
          ),
        ]
      : []),
    buildAuditEventStatement({
      actorUserId: principal.userId,
      action: "role.permissions_set",
      targetType: "role",
      targetId: input.roleId,
      metadata: {
        roleName: role.name,
        permissionIds: input.permissionIds,
      },
    }),
  ];
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);

  // KV invalidation is best-effort post-commit: D1 has already
  // committed the permission change AND the audit row, so throwing
  // here would return an error to a caller whose action did succeed,
  // and the retry would write a duplicate audit row for the same
  // logical change. Swallow + log instead — the cache has a 5-minute
  // TTL, so a missed invalidation self-corrects.
  if (input.roleId === ANONYMOUS_ROLE_ID) {
    try {
      await invalidateAnonymousPermissionsCache();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("rbac.cache_invalidation_failed", {
        scope: "anonymous_permissions",
        roleId: input.roleId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
    .where(eq(schema.userRoles.userId, userId))
    .orderBy(asc(schema.roles.position), asc(schema.roles.name));
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
  // Unclaimed (officer-pre-added) stubs must claim their account
  // before they can hold any roles. Pre-assigning would let us grant
  // the `member` role to a row that may never become a real member,
  // which inflates the role-permission picture downstream.
  if (user.status === "unclaimed") {
    throw new Error("Cannot assign roles to an unclaimed member");
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

  // Capture the prior role set so we can audit the diff (assigned /
  // unassigned), not just the post-state. The viewer cares about
  // "who got promoted to system_admin?", which is a delta question.
  const prior = await db
    .select({ roleId: schema.userRoles.roleId })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, input.userId));
  const priorIds = new Set(prior.map((r) => r.roleId));
  const nextIds = new Set(roleIds);
  const assigned = roleIds.filter((id) => !priorIds.has(id));
  const unassigned = [...priorIds].filter((id) => !nextIds.has(id));

  // One row per added / removed role so the audit page can answer
  // "who granted X this role?" with a single index lookup.
  const events = [
    ...assigned.map((roleId) => ({
      actorUserId: principal.userId,
      action: "role.assigned" as const,
      targetUserId: input.userId,
      targetType: "role",
      targetId: roleId,
    })),
    ...unassigned.map((roleId) => ({
      actorUserId: principal.userId,
      action: "role.unassigned" as const,
      targetUserId: input.userId,
      targetType: "role",
      targetId: roleId,
    })),
  ];

  // Replace-all: delete existing assignments, insert new set, audit
  // the diff. All atomic via D1 batch.
  const auditStmt = buildBulkAuditEventStatement(events);
  const stmts = [
    db
      .delete(schema.userRoles)
      .where(eq(schema.userRoles.userId, input.userId)),
    ...(roleIds.length > 0
      ? [
          db.insert(schema.userRoles).values(
            roleIds.map((roleId) => ({
              userId: input.userId,
              roleId,
            })),
          ),
        ]
      : []),
    ...(auditStmt ? [auditStmt] : []),
  ];
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);

  return { ok: true };
}

// ── role -> member assignments ─────────────────────────────────────────

/**
 * Replace the full member set of one role. The role-keyed sibling of
 * `setUserRolesAction`, which is user-keyed: the `/access` role sheet
 * edits membership from the role's side and stages the whole set
 * behind a Save, exactly like its Permissions tab, so the action takes
 * the post-state rather than a stream of add/remove deltas. Replaying
 * that through the user-keyed action would mean N round trips plus a
 * read-modify-write race against any concurrent edit to those users'
 * *other* roles.
 *
 * Gated on `roles:assign` rather than `roles:manage` — this writes
 * `user_roles` rows, the same operation the member detail page
 * performs, so it answers to the same permission even though the
 * surface it's reached from is gated on `roles:manage`.
 */
export async function setRoleMembersAction(input: {
  roleId: string;
  userIds: string[];
}): Promise<{ ok: true }> {
  const principal = await requireRolesAssigner();
  const db = getDb();

  // The anonymous role models signed-out visitors, so it has no
  // members by construction — `setUserRolesAction` filters it out of
  // every assignment. Reject rather than silently no-op.
  if (input.roleId === ANONYMOUS_ROLE_ID) {
    throw new Error("The anonymous role cannot be assigned to members");
  }
  // `setUserRolesAction` force-adds the member role back to every
  // approved user, so honoring a removal here would either be undone
  // by the next user-keyed save or leave the two paths disagreeing
  // about what "approved" implies. Membership follows account status.
  if (input.roleId === MEMBER_ROLE_ID) {
    throw new Error(
      "The member role follows account status and cannot be edited directly",
    );
  }

  // De-dupe before diffing so a repeated id can't produce a
  // primary-key violation on `(user_id, role_id)`.
  const userIds = [...new Set(input.userIds)];

  // Role existence and the prior member set both key on `roleId`
  // alone, so they ride one D1 request. Target-user validation needs
  // `userIds` and is skipped entirely when the save only removes.
  const [roleRows, prior] = await db.batch([
    db
      .select({ id: schema.roles.id, name: schema.roles.name })
      .from(schema.roles)
      .where(eq(schema.roles.id, input.roleId))
      .limit(1),
    db
      .select({ userId: schema.userRoles.userId })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.roleId, input.roleId)),
  ]);

  if (roleRows.length === 0) {
    throw new Error("Role not found");
  }

  // Validate every target exists and may hold roles at all. Unclaimed
  // (officer-pre-added) stubs must claim their account first — the
  // same rule the user-keyed path enforces.
  if (userIds.length > 0) {
    const targetUsers = await db
      .select({ id: schema.users.id, status: schema.users.status })
      .from(schema.users)
      .where(inArray(schema.users.id, userIds));
    const byId = new Map(targetUsers.map((u) => [u.id, u.status]));
    for (const userId of userIds) {
      const status = byId.get(userId);
      if (status === undefined) {
        throw new Error(`User "${userId}" does not exist`);
      }
      if (status === "unclaimed") {
        throw new Error("Cannot assign roles to an unclaimed member");
      }
    }
  }

  const priorIds = new Set(prior.map((r) => r.userId));
  const nextIds = new Set(userIds);

  // Self-demotion guard, mirroring the user-keyed path: don't let an
  // admin drop their own system_admin and lock themselves out of the
  // surface they're standing on.
  if (
    input.roleId === SYSTEM_ADMIN_ROLE_ID &&
    priorIds.has(principal.userId) &&
    !nextIds.has(principal.userId)
  ) {
    throw new Error("Cannot remove system_admin from yourself");
  }

  const assigned = userIds.filter((id) => !priorIds.has(id));
  const unassigned = [...priorIds].filter((id) => !nextIds.has(id));

  if (assigned.length === 0 && unassigned.length === 0) {
    return { ok: true };
  }

  // One audit row per added / removed member, matching the shape the
  // user-keyed path writes, so the audit page answers "who granted X
  // this role?" the same way regardless of which surface did it.
  const auditStmt = buildBulkAuditEventStatement([
    ...assigned.map((userId) => ({
      actorUserId: principal.userId,
      action: "role.assigned" as const,
      targetUserId: userId,
      targetType: "role",
      targetId: input.roleId,
    })),
    ...unassigned.map((userId) => ({
      actorUserId: principal.userId,
      action: "role.unassigned" as const,
      targetUserId: userId,
      targetType: "role",
      targetId: input.roleId,
    })),
  ]);

  // Diff-based writes rather than the replace-all delete+insert the
  // permissions path uses: `user_roles` rows for *this* role are the
  // only ones in scope, and touching only the delta keeps the
  // statement count flat when a role has many members and one changes.
  const stmts = [
    ...(unassigned.length > 0
      ? [
          db
            .delete(schema.userRoles)
            .where(
              and(
                eq(schema.userRoles.roleId, input.roleId),
                inArray(schema.userRoles.userId, unassigned),
              ),
            ),
        ]
      : []),
    ...(assigned.length > 0
      ? [
          db
            .insert(schema.userRoles)
            .values(
              assigned.map((userId) => ({ userId, roleId: input.roleId })),
            )
            .onConflictDoNothing(),
        ]
      : []),
    ...(auditStmt ? [auditStmt] : []),
  ];
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);

  return { ok: true };
}

// ── role reordering ────────────────────────────────────────────────────

/**
 * Reorder all roles. Caller passes the full list of role ids in their
 * desired order; we assign `position = index` to each. Atomic via D1's
 * batch API (see `landing-repo` for the same pattern — Drizzle's
 * `db.transaction` issues `BEGIN/COMMIT` SQL that workerd D1 rejects).
 */
export async function reorderRolesAction(input: {
  orderedRoleIds: string[];
}): Promise<{ ok: true }> {
  await requireRolesManager();
  const db = getDb();

  const seen = new Set<string>();
  for (const id of input.orderedRoleIds) {
    if (seen.has(id)) {
      throw new Error(`Duplicate role id in order: ${id}`);
    }
    seen.add(id);
  }

  const existing = await db.query.roles.findMany({ columns: { id: true } });
  if (existing.length !== input.orderedRoleIds.length) {
    throw new Error(
      `Order list size (${input.orderedRoleIds.length}) does not match role count (${existing.length})`,
    );
  }
  for (const r of existing) {
    if (!seen.has(r.id)) {
      throw new Error(`Order list missing role: ${r.id}`);
    }
  }

  if (input.orderedRoleIds.length === 0) {
    return { ok: true };
  }

  const stmts = input.orderedRoleIds.map((id, i) =>
    db.update(schema.roles).set({ position: i }).where(eq(schema.roles.id, id)),
  );
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);

  return { ok: true };
}
