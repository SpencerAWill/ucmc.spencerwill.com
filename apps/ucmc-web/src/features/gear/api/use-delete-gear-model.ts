import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_DETAIL_QUERY_KEY,
  GEAR_MODELS_QUERY_KEY,
  GEAR_QUERY_KEY,
} from "#/features/gear/api/query-keys";
import { deleteGearModelFn } from "#/features/gear/server/gear-fns";

export function useDeleteGearModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { publicId: string }) =>
      deleteGearModelFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: GEAR_MODELS_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: GEAR_DETAIL_QUERY_KEY }),
        ]);
      }
    },
  });
}
