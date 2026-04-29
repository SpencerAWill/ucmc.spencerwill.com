import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  ROLES_QUERY_KEY,
  roleQueryKey,
} from "#/features/members/api/query-keys";
import { bulkSetRolePermissionsFn } from "#/features/members/server/rbac-fns";

export function useBulkSetRolePermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      roles: { roleId: string; permissionIds: string[] }[];
    }) => bulkSetRolePermissionsFn({ data: input }),
    onSuccess: async (_data, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY }),
        ...vars.roles.map((entry) =>
          queryClient.invalidateQueries({
            queryKey: roleQueryKey(entry.roleId),
          }),
        ),
      ]);
    },
  });
}
