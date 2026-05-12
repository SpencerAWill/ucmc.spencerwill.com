import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_QUERY_KEY,
  GEAR_TAGS_QUERY_KEY,
} from "#/features/gear/api/query-keys";
import { editGearTagFn } from "#/features/gear/server/gear-fns";
import type { EditGearTagInput } from "#/features/gear/server/gear-fns";

export function useEditGearTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EditGearTagInput) => editGearTagFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        // Tag names are rendered as chips on every gear card, so the
        // gear list cache needs to refetch alongside the tags cache.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: GEAR_TAGS_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
        ]);
      }
    },
  });
}
