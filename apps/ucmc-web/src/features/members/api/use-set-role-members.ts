import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_DETAIL_QUERY_KEY,
  MEMBERS_DIRECTORY_QUERY_KEY,
  ROLES_QUERY_KEY,
  USER_ROLES_QUERY_KEY,
  roleQueryKey,
} from "#/features/members/api/query-keys";
import { setRoleMembersFn } from "#/features/members/server/rbac-fns";

/**
 * Add and remove members of one role from the role's side — the
 * `/access` role sheet's Members tab. The user-keyed counterpart is
 * `useSetUserRoles`, which replaces a single user's whole role set.
 *
 * Takes an `add` / `remove` diff rather than the post-state so a save
 * can't unassign a member some other surface granted the role to
 * while the sheet was open; see `setRoleMembersAction`.
 *
 * Invalidates the role detail (the sheet's own member list), the roles
 * prefix (`memberCount` on the /access list), and the directory (role
 * badges render inline). The last two are prefix-wide because the
 * caller knows only userIds: per-user assignment caches key on
 * `userId` and member-detail caches key on `publicId`, so there's no
 * single entry to target — and the member detail page renders its
 * roles from `MemberDetail.roles`, not from the user-roles cache, so
 * invalidating only the latter would leave /members/$publicId showing
 * stale role badges.
 */
export function useSetRoleMembers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { roleId: string; add: string[]; remove: string[] }) =>
      setRoleMembersFn({ data: input }),
    onSuccess: async (_data, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: roleQueryKey(vars.roleId) }),
        queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY }),
        queryClient.invalidateQueries({
          queryKey: MEMBERS_DIRECTORY_QUERY_KEY,
        }),
        queryClient.invalidateQueries({ queryKey: USER_ROLES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: MEMBERS_DETAIL_QUERY_KEY }),
      ]);
    },
  });
}
