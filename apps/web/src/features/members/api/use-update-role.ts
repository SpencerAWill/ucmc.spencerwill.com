import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import {
  ROLES_QUERY_KEY,
  roleQueryKey,
} from "#/features/members/api/query-keys";
import { updateRoleFn } from "#/features/members/server/rbac-fns";

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      roleId: string;
      description?: string | null;
      displayName?: string;
      isOfficer?: boolean;
    }) => updateRoleFn({ data: input }),
    onSuccess: async (_data, vars) => {
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: roleQueryKey(vars.roleId) }),
      ];
      // Only the displayName + isOfficer fields surface on the public
      // home page. Description-only edits don't change anything the
      // landing bundle renders, so skip the cross-feature invalidation
      // in that case.
      if (vars.displayName !== undefined || vars.isOfficer !== undefined) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: LANDING_CONTENT_QUERY_KEY,
          }),
        );
      }
      await Promise.all(invalidations);
    },
  });
}
