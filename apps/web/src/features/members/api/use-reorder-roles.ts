import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ROLES_QUERY_KEY } from "#/features/members/api/query-keys";
import { reorderRolesFn } from "#/features/members/server/rbac-fns";

export function useReorderRoles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { orderedRoleIds: string[] }) =>
      reorderRolesFn({ data: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });
}
