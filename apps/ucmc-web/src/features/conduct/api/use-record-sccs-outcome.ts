import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_DETAIL_PREFIX,
  conductKeys,
} from "#/features/conduct/api/query-keys";
import type { SccsOutcomeInput } from "#/features/conduct/server/limits";
import { recordSccsOutcomeFn } from "#/features/conduct/server/record-fns";

/**
 * Records what SCCS decided. Invalidates every conduct query and the members detail cache
 * (it embeds a member's conduct summary). The caller owns toasts.
 */
export function useRecordSccsOutcome() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SccsOutcomeInput) => recordSccsOutcomeFn({ data }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: conductKeys.all }),
        queryClient.invalidateQueries({ queryKey: MEMBERS_DETAIL_PREFIX }),
      ]);
    },
  });
}
