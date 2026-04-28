import {
  MEMBERS_DIRECTORY_QUERY_KEY,
  MEMBERS_REGISTRATIONS_QUERY_KEY,
  PERMISSIONS_QUERY_KEY,
  ROLES_QUERY_KEY,
  memberDetailQueryKey,
  roleQueryKey,
  userRolesQueryKey,
} from "#/features/members/api/query-keys";
import type { ListMembersInput } from "#/features/members/server/member-fns";
import {
  getMemberDetailFn,
  listMembersFn,
  listPendingRegistrationsFn,
  listRolesFn,
} from "#/features/members/server/member-fns";
import {
  getRoleFn,
  getUserRolesFn,
  listPermissionsFn,
  listRolesDetailedFn,
} from "#/features/members/server/rbac-fns";

/** Approved member directory. Optional filter input shapes the query key. */
export function membersDirectoryQueryOptions(input?: ListMembersInput) {
  return {
    queryKey: input
      ? ([...MEMBERS_DIRECTORY_QUERY_KEY, input] as const)
      : MEMBERS_DIRECTORY_QUERY_KEY,
    queryFn: () => listMembersFn({ data: input ?? {} }),
  } as const;
}

/** Pending registrations awaiting approval — admin queue. */
export function membersRegistrationsQueryOptions() {
  return {
    queryKey: MEMBERS_REGISTRATIONS_QUERY_KEY,
    queryFn: () => listPendingRegistrationsFn({ data: {} }),
  } as const;
}

/** Detail page for one member (by public id). */
export function memberDetailQueryOptions(publicId: string) {
  return {
    queryKey: memberDetailQueryKey(publicId),
    queryFn: () => getMemberDetailFn({ data: { publicId } }),
  } as const;
}

/** Lightweight roles list — id + label, used in the directory filter. */
export function rolesQueryOptions() {
  return {
    queryKey: ROLES_QUERY_KEY,
    queryFn: () => listRolesFn(),
  } as const;
}

/**
 * Detailed roles list with member counts and permission summaries.
 * Lives at the same query key as the lightweight list because consumers
 * never need both at once — choose your shape with this options factory
 * vs. `rolesQueryOptions()`.
 */
export function rolesDetailedQueryOptions() {
  return {
    queryKey: ROLES_QUERY_KEY,
    queryFn: () => listRolesDetailedFn(),
  } as const;
}

/** Single role with its full permission set. */
export function roleQueryOptions(roleId: string) {
  return {
    queryKey: roleQueryKey(roleId),
    queryFn: () => getRoleFn({ data: { roleId } }),
  } as const;
}

/** All available permissions — keyed and consumed by the role editor. */
export function permissionsQueryOptions() {
  return {
    queryKey: PERMISSIONS_QUERY_KEY,
    queryFn: () => listPermissionsFn(),
  } as const;
}

/** A given user's role assignments — used by the assignment sheet. */
export function userRolesQueryOptions(userId: string) {
  return {
    queryKey: userRolesQueryKey(userId),
    queryFn: () => getUserRolesFn({ data: { userId } }),
  } as const;
}
