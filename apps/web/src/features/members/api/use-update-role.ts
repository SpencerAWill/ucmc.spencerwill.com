import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  ROLES_QUERY_KEY,
  roleQueryKey,
} from "#/features/members/api/query-keys";
import { updateRoleFn } from "#/features/members/server/rbac-fns";

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { roleId: string; description: string | null }) =>
      updateRoleFn({ data: input }),
    onSuccess: async (_data, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY }),
        queryClient.invalidateQueries({
          queryKey: roleQueryKey(vars.roleId),
        }),
      ]);
    },
  });
}
