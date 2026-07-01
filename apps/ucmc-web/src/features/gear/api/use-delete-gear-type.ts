import { useMutation, useQueryClient } from "@tanstack/react-query";

import { GEAR_TYPES_QUERY_KEY } from "#/features/gear/api/query-keys";
import { deleteGearTypeFn } from "#/features/gear/server/gear-fns";

export function useDeleteGearType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { publicId: string }) =>
      deleteGearTypeFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        await queryClient.invalidateQueries({
          queryKey: GEAR_TYPES_QUERY_KEY,
        });
      }
    },
  });
}
