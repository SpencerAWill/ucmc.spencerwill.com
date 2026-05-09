import { useMutation, useQueryClient } from "@tanstack/react-query";

import { MEMBERS_UNCLAIMED_QUERY_KEY } from "#/features/members/api/query-keys";
import { preAddUnclaimedFn } from "#/features/members/server/member-fns";
import type { PreAddUnclaimedInput } from "#/features/members/server/member-fns";

/**
 * Bulk pre-add of unclaimed (officer-imported) members. Returns a
 * discriminated `{ ok: true | false }` result; the `ok: true` branch
 * carries per-row created/skipped lists for the call site to render
 * inline. Invalidates the unclaimed list when at least one row was
 * actually created.
 */
export function usePreAddUnclaimed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PreAddUnclaimedInput) =>
      preAddUnclaimedFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok && result.created.length > 0) {
        await queryClient.invalidateQueries({
          queryKey: MEMBERS_UNCLAIMED_QUERY_KEY,
        });
      }
    },
  });
}
