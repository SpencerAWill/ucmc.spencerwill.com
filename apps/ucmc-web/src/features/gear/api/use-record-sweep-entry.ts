import { useMutation, useQueryClient } from "@tanstack/react-query";

import { GEAR_SWEEPS_QUERY_KEY } from "#/features/gear/api/query-keys";
import { recordSweepEntryFn } from "#/features/gear/server/gear-fns";
import type { RecordSweepEntryInput } from "#/features/gear/server/gear-fns";

export function useRecordSweepEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordSweepEntryInput) =>
      recordSweepEntryFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        await queryClient.invalidateQueries({
          queryKey: GEAR_SWEEPS_QUERY_KEY,
        });
      }
    },
  });
}
