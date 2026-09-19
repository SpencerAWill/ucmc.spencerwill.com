import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_ATTRIBUTE_DEFS_QUERY_KEY,
  GEAR_QUERY_KEY,
} from "#/features/gear/api/query-keys";
import { updateGearAttributeDefFn } from "#/features/gear/server/gear-fns";
import type { UpdateGearAttributeDefInput } from "#/features/gear/server/gear-fns";

export function useUpdateGearAttribute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGearAttributeDefInput) =>
      updateGearAttributeDefFn({ data: input }),
    onSuccess: async (result) => {
      if (!result.ok) {
        return;
      }
      // A relabel or an archive changes what the gear rows print, so
      // the list goes too — the def list alone would leave stale
      // labels on every card until the next navigation.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: GEAR_ATTRIBUTE_DEFS_QUERY_KEY,
        }),
        queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
      ]);
    },
  });
}
