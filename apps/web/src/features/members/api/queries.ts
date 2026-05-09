import {
  MEMBERS_DIRECTORY_QUERY_KEY,
  MEMBERS_REGISTRATIONS_QUERY_KEY,
  MEMBERS_UNCLAIMED_QUERY_KEY,
  PERMISSIONS_QUERY_KEY,
  ROLES_DETAILED_QUERY_KEY,
  ROLES_QUERY_KEY,
  memberDetailQueryKey,
  roleQueryKey,
  userRolesQueryKey,
} from "#/features/members/api/query-keys";
import type {
  ListMembersInput,
  ListPendingRegistrationsInput,
  ListUnclaimedInput,
} from "#/features/members/server/member-fns";
import {
  getMemberDetailFn,
  listMembersFn,
  listPendingRegistrationsFn,
  listRolesFn,
  listUnclaimedFn,
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

/**
 * Pending registrations awaiting approval — admin queue. Filter +
 * pagination inputs are part of the cache key so flipping any of them
 * cache-misses cleanly. Both the approve and reject mutation hooks
 * invalidate by the bare `MEMBERS_REGISTRATIONS_QUERY_KEY` prefix, so
 * any input shape under this key is invalidated together.
 */
export function pendingRegistrationsQueryOptions(
  input: ListPendingRegistrationsInput,
) {
  return {
    queryKey: [...MEMBERS_REGISTRATIONS_QUERY_KEY, input] as const,
    queryFn: () => listPendingRegistrationsFn({ data: input }),
  } as const;
}

/**
 * Rejected members — the "rejected" tab on /members/registrations.
 * Lives under the registrations key so the unreject mutation's prefix
 * invalidation hits both the pending feed and this rejected list.
 * `listMembersFn` is called with `statuses: "rejected"` baked in so
 * the call site only owns pagination.
 */
export function rejectedMembersQueryOptions(input: {
  limit: number;
  offset: number;
}) {
  return {
    queryKey: [...MEMBERS_REGISTRATIONS_QUERY_KEY, "rejected", input] as const,
    queryFn: () =>
      listMembersFn({
        data: {
          statuses: "rejected",
          sort: "newest",
          limit: input.limit,
          offset: input.offset,
        },
      }),
  } as const;
}

/**
 * Officer-pre-added unclaimed members. Pagination + date-range inputs
 * are part of the cache key so flipping any of them cache-misses
 * cleanly. Pre-add / edit / delete mutations invalidate by the bare
 * `MEMBERS_UNCLAIMED_QUERY_KEY` prefix, so any input shape under this
 * key is invalidated together.
 */
export function unclaimedMembersQueryOptions(input: ListUnclaimedInput) {
  return {
    queryKey: [...MEMBERS_UNCLAIMED_QUERY_KEY, input] as const,
    queryFn: () => listUnclaimedFn({ data: input }),
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
 * Keyed as a child of `ROLES_QUERY_KEY` so role mutations invalidate both
 * shapes by prefix, but the cache entries stay distinct — sharing a key
 * with the lightweight list let the directory's cached `RoleOption[]`
 * flash through this consumer and crash on `permissionIds`.
 */
export function rolesDetailedQueryOptions() {
  return {
    queryKey: ROLES_DETAILED_QUERY_KEY,
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
