import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_DETAIL_QUERY_KEY,
  GEAR_QUERY_KEY,
  GEAR_SWEEPS_QUERY_KEY,
} from "#/features/gear/api/query-keys";
import { closeSweepFn } from "#/features/gear/server/gear-fns";

export function useCloseSweep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { notes?: string | null }) =>
      closeSweepFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        // Closing is the one action that rewrites items wholesale —
        // everything unseen becomes `missing`, so the gear list is
        // stale the moment it lands.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: GEAR_SWEEPS_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: GEAR_DETAIL_QUERY_KEY }),
        ]);
      }
    },
  });
}
