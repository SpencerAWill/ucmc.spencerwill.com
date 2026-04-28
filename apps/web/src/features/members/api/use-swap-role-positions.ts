import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ROLES_QUERY_KEY } from "#/features/members/api/query-keys";
import { swapRolePositionsFn } from "#/features/members/server/rbac-fns";

/** Move a role up or down in the displayed order. */
export function useSwapRolePositions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { roleId: string; direction: "up" | "down" }) =>
      swapRolePositionsFn({ data: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });
}
