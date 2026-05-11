import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_QUERY_KEY,
  GEAR_TAGS_QUERY_KEY,
} from "#/features/gear/api/query-keys";
import { deleteGearTagFn } from "#/features/gear/server/gear-fns";

export function useDeleteGearTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { publicId: string }) =>
      deleteGearTagFn({ data: input }),
    onSuccess: async () => {
      // Tag deletion cascades through gear_tag_assignments, so gear
      // rows lose the chip from their card. Refresh both surfaces.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: GEAR_TAGS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
      ]);
    },
  });
}
