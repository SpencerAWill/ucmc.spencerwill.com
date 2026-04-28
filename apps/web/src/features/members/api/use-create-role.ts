import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ROLES_QUERY_KEY } from "#/features/members/api/query-keys";
import { createRoleFn } from "#/features/members/server/rbac-fns";

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      createRoleFn({ data: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });
}
