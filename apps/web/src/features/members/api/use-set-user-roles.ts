import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_DIRECTORY_QUERY_KEY,
  memberDetailQueryKey,
  userRolesQueryKey,
} from "#/features/members/api/query-keys";
import { setUserRolesFn } from "#/features/members/server/rbac-fns";

/**
 * Replace a user's role assignments. Invalidates the user-roles cache
 * (the assignment sheet re-reads), the directory (role badges render
 * inline), and the optional detail page if the caller is editing from
 * /members/$publicId.
 */
export function useSetUserRoles(detailPublicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; roleIds: string[] }) =>
      setUserRolesFn({ data: input }),
    onSuccess: async (_data, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: userRolesQueryKey(vars.userId),
        }),
        queryClient.invalidateQueries({
          queryKey: MEMBERS_DIRECTORY_QUERY_KEY,
        }),
        detailPublicId
          ? queryClient.invalidateQueries({
              queryKey: memberDetailQueryKey(detailPublicId),
            })
          : Promise.resolve(),
      ]);
    },
  });
}
