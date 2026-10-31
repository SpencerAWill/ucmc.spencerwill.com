import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_DETAIL_PREFIX,
  conductKeys,
} from "#/features/conduct/api/query-keys";
import type { ReferInput } from "#/features/conduct/server/limits";
import { referConductRecordFn } from "#/features/conduct/server/record-fns";

/**
 * Refers a record to SCCS. Invalidates every conduct query and the members detail cache
 * (it embeds a member's conduct summary). The caller owns toasts.
 */
export function useReferConductRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ReferInput) => referConductRecordFn({ data }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: conductKeys.all }),
        queryClient.invalidateQueries({ queryKey: MEMBERS_DETAIL_PREFIX }),
      ]);
    },
  });
}
