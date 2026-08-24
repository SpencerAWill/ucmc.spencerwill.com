import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_DIRECTORY_QUERY_KEY,
  ROLES_QUERY_KEY,
  USER_ROLES_QUERY_KEY,
  roleQueryKey,
} from "#/features/members/api/query-keys";
import { setRoleMembersFn } from "#/features/members/server/rbac-fns";

/**
 * Replace one role's member set from the role's side — the `/access`
 * role sheet's Members tab. The user-keyed counterpart is
 * `useSetUserRoles`, which replaces a single user's whole role set.
 *
 * Invalidates the role detail (the sheet's own member list), the roles
 * prefix (`memberCount` on the /access list), the directory (role
 * badges render inline), and the whole per-user assignment prefix so
 * the member detail page agrees.
 */
export function useSetRoleMembers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { roleId: string; userIds: string[] }) =>
      setRoleMembersFn({ data: input }),
    onSuccess: async (_data, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: roleQueryKey(vars.roleId) }),
        queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY }),
        queryClient.invalidateQueries({
          queryKey: MEMBERS_DIRECTORY_QUERY_KEY,
        }),
        // Any user whose assignments could have changed — the caller
        // only knows the post-state, so invalidate the whole
        // per-user prefix rather than guessing the diff.
        queryClient.invalidateQueries({ queryKey: USER_ROLES_QUERY_KEY }),
      ]);
    },
  });
}
