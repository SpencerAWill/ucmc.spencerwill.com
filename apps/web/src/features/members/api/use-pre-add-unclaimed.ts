import { useMutation, useQueryClient } from "@tanstack/react-query";

import { MEMBERS_UNCLAIMED_QUERY_KEY } from "#/features/members/api/query-keys";
import { preAddUnclaimedFn } from "#/features/members/server/member-fns";
import type { PreAddUnclaimedInput } from "#/features/members/server/member-fns";

/**
 * Bulk pre-add of unclaimed (officer-imported) members. Returns a
 * per-row result so the call site can render created vs. skipped rows
 * inline. Invalidates the unclaimed list on any non-zero outcome.
 */
export function usePreAddUnclaimed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PreAddUnclaimedInput) =>
      preAddUnclaimedFn({ data: input }),
    onSuccess: async (result) => {
      if (result.created.length > 0) {
        await queryClient.invalidateQueries({
          queryKey: MEMBERS_UNCLAIMED_QUERY_KEY,
        });
      }
    },
  });
}
