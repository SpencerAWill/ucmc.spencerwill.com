import { useMutation, useQueryClient } from "@tanstack/react-query";

import { GEAR_ATTRIBUTE_DEFS_QUERY_KEY } from "#/features/gear/api/query-keys";
import { createGearAttributeDefFn } from "#/features/gear/server/gear-fns";
import type { CreateGearAttributeDefInput } from "#/features/gear/server/gear-fns";

export function useCreateGearAttribute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGearAttributeDefInput) =>
      createGearAttributeDefFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        await queryClient.invalidateQueries({
          queryKey: GEAR_ATTRIBUTE_DEFS_QUERY_KEY,
        });
      }
    },
  });
}
