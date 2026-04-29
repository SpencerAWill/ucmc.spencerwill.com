/**
 * TanStack Query keys for the members feature, including the RBAC
 * sub-surface (roles, permissions, user-role assignments). Centralized
 * so query options and mutation hooks always invalidate the same key —
 * a key drift would silently leave stale lists on screen.
 *
 * Per-entity keys take an id and return a typed tuple so the call site
 * doesn't have to remember the prefix shape.
 */

// Member-management queries
export const MEMBERS_DIRECTORY_QUERY_KEY = ["members", "directory"] as const;

export const MEMBERS_REGISTRATIONS_QUERY_KEY = [
  "members",
  "registrations",
] as const;

export const memberDetailQueryKey = (publicId: string) =>
  ["members", "detail", publicId] as const;

// RBAC queries
export const ROLES_QUERY_KEY = ["rbac", "roles"] as const;

export const ROLES_DETAILED_QUERY_KEY = ["rbac", "roles", "detailed"] as const;

export const PERMISSIONS_QUERY_KEY = ["rbac", "permissions"] as const;

export const userRolesQueryKey = (userId: string) =>
  ["rbac", "userRoles", userId] as const;

export const roleQueryKey = (roleId: string) =>
  ["rbac", "role", roleId] as const;
