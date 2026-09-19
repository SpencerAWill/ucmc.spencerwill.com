import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_ATTRIBUTE_DEFS_QUERY_KEY,
  GEAR_QUERY_KEY,
} from "#/features/gear/api/query-keys";
import { deleteGearAttributeDefFn } from "#/features/gear/server/gear-fns";

export function useDeleteGearAttribute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { publicId: string }) =>
      deleteGearAttributeDefFn({ data: input }),
    onSuccess: async (result) => {
      if (!result.ok) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: GEAR_ATTRIBUTE_DEFS_QUERY_KEY,
        }),
        queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
      ]);
    },
  });
}
