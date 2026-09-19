import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_HOLDS_QUERY_KEY,
  GEAR_QUERY_KEY,
} from "#/features/gear/api/query-keys";
import { releaseGearHoldFn } from "#/features/gear/server/gear-fns";

export function useReleaseGearHold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { publicId: string }) =>
      releaseGearHoldFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: GEAR_HOLDS_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
        ]);
      }
    },
  });
}
