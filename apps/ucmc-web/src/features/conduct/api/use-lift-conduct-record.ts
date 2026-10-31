import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_DETAIL_PREFIX,
  conductKeys,
} from "#/features/conduct/api/query-keys";
import type { LiftInput } from "#/features/conduct/server/limits";
import { liftConductRecordFn } from "#/features/conduct/server/record-fns";

/**
 * Lifts a record. Invalidates every conduct query and the members detail cache
 * (it embeds a member's conduct summary). The caller owns toasts.
 */
export function useLiftConductRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: LiftInput) => liftConductRecordFn({ data }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: conductKeys.all }),
        queryClient.invalidateQueries({ queryKey: MEMBERS_DETAIL_PREFIX }),
      ]);
    },
  });
}
