import { useMutation, useQueryClient } from "@tanstack/react-query";

import { MEMBERS_UNCLAIMED_QUERY_KEY } from "#/features/members/api/query-keys";
import { deleteUnclaimedFn } from "#/features/members/server/member-fns";

/**
 * Bulk-delete unclaimed (officer-imported) members. Hard delete via
 * the server action; cascades clear the user_emails row. Invalidates
 * the unclaimed list on success.
 */
export function useDeleteUnclaimed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) => deleteUnclaimedFn({ data: { userIds } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: MEMBERS_UNCLAIMED_QUERY_KEY,
      });
    },
  });
}
