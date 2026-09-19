import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_HOLDS_QUERY_KEY,
  GEAR_QUERY_KEY,
} from "#/features/gear/api/query-keys";
import { placeGearHoldFn } from "#/features/gear/server/gear-fns";
import type { PlaceGearHoldInput } from "#/features/gear/server/gear-fns";

export function usePlaceGearHold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PlaceGearHoldInput) => placeGearHoldFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        // The gear list carries availability, and a live hold changes
        // it — invalidating only the holds list would leave the card
        // reading "Available" next to its own hold badge.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: GEAR_HOLDS_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
        ]);
      }
    },
  });
}
