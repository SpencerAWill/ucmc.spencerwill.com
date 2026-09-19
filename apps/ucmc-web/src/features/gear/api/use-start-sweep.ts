import { useMutation, useQueryClient } from "@tanstack/react-query";

import { GEAR_SWEEPS_QUERY_KEY } from "#/features/gear/api/query-keys";
import { startSweepFn } from "#/features/gear/server/gear-fns";

export function useStartSweep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => startSweepFn(),
    onSuccess: async () => {
      // Invalidated even on the `already_open` result: that answer
      // names an open sweep this client didn't know about, and the
      // pane needs to load it rather than keep showing "none".
      await queryClient.invalidateQueries({ queryKey: GEAR_SWEEPS_QUERY_KEY });
    },
  });
}
