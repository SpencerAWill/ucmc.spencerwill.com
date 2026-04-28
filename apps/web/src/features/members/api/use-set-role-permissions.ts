import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  ROLES_QUERY_KEY,
  roleQueryKey,
} from "#/features/members/api/query-keys";
import { setRolePermissionsFn } from "#/features/members/server/rbac-fns";

export function useSetRolePermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { roleId: string; permissionIds: string[] }) =>
      setRolePermissionsFn({ data: input }),
    onSuccess: async (_data, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: roleQueryKey(vars.roleId),
        }),
        queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY }),
      ]);
    },
  });
}
