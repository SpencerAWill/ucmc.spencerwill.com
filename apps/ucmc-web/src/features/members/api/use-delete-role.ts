import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ROLES_QUERY_KEY } from "#/features/members/api/query-keys";
import { deleteRoleFn } from "#/features/members/server/rbac-fns";

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) => deleteRoleFn({ data: { roleId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });
}
