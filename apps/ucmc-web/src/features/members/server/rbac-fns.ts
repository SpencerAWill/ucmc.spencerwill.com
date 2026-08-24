/**
 * Route-facing shells for RBAC management server fns (role CRUD,
 * permission grants, user-role assignments). Each handler dynamic-imports
 * its implementation from `./rbac-actions.server` so server-only code
 * stays off the client module graph.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type {
  PermissionSummary,
  RoleDetail,
  RoleWithPermissions,
} from "#/features/members/server/rbac-actions.server";

export type { PermissionSummary, RoleDetail, RoleWithPermissions };

// ── role queries ───────────────────────────────────────────────────────

export const listRolesDetailedFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<RoleWithPermissions[]> => {
    const { listRolesDetailedAction } =
      await import("#/features/members/server/rbac-actions.server");
    return listRolesDetailedAction();
  },
);

export const getRoleFn = createServerFn({ method: "GET" })
  .validator(z.object({ roleId: z.string().min(1) }))
  .handler(async ({ data }): Promise<RoleDetail> => {
    const { getRoleAction } =
      await import("#/features/members/server/rbac-actions.server");
    return getRoleAction(data.roleId);
  });

// ── role mutations ─────────────────────────────────────────────────────

const roleNameSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .max(60, "At most 60 characters")
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Lowercase letters, digits, and underscores only; must start with a letter",
  );

const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .max(80, "At most 80 characters");

export const createRoleFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: roleNameSchema,
      displayName: displayNameSchema,
      description: z.string().trim().max(200).optional(),
      isOfficer: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ roleId: string }> => {
    const { createRoleAction } =
      await import("#/features/members/server/rbac-actions.server");
    return createRoleAction(data);
  });

export const updateRoleFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      roleId: z.string().min(1),
      description: z.string().trim().max(200).nullable().optional(),
      displayName: displayNameSchema.optional(),
      isOfficer: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateRoleAction } =
      await import("#/features/members/server/rbac-actions.server");
    return updateRoleAction(data);
  });

export const deleteRoleFn = createServerFn({ method: "POST" })
  .validator(z.object({ roleId: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteRoleAction } =
      await import("#/features/members/server/rbac-actions.server");
    return deleteRoleAction(data.roleId);
  });

// ── permission queries ─────────────────────────────────────────────────

export const listPermissionsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PermissionSummary[]> => {
    const { listPermissionsAction } =
      await import("#/features/members/server/rbac-actions.server");
    return listPermissionsAction();
  },
);

// ── role <-> permission grants ─────────────────────────────────────────

export const setRolePermissionsFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      roleId: z.string().min(1),
      permissionIds: z.array(z.string().min(1)),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { setRolePermissionsAction } =
      await import("#/features/members/server/rbac-actions.server");
    return setRolePermissionsAction(data);
  });

// ── user <-> role assignments ──────────────────────────────────────────

export const getUserRolesFn = createServerFn({ method: "GET" })
  .validator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ roleId: string; name: string }[]> => {
    const { getUserRolesAction } =
      await import("#/features/members/server/rbac-actions.server");
    return getUserRolesAction(data.userId);
  });

export const setUserRolesFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      userId: z.string().min(1),
      roleIds: z.array(z.string().min(1)),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { setUserRolesAction } =
      await import("#/features/members/server/rbac-actions.server");
    return setUserRolesAction(data);
  });

// ── role -> member assignments ─────────────────────────────────────────

export const setRoleMembersFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      roleId: z.string().min(1),
      userIds: z.array(z.string().min(1)),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { setRoleMembersAction } =
      await import("#/features/members/server/rbac-actions.server");
    return setRoleMembersAction(data);
  });

// ── role reordering ────────────────────────────────────────────────────

export const reorderRolesFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orderedRoleIds: z.array(z.string().min(1)),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { reorderRolesAction } =
      await import("#/features/members/server/rbac-actions.server");
    return reorderRolesAction(data);
  });
