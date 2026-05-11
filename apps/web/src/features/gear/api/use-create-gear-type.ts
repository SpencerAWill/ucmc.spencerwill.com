import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_QUERY_KEY,
  GEAR_TYPES_QUERY_KEY,
} from "#/features/gear/api/query-keys";
import { createGearTypeFn } from "#/features/gear/server/gear-fns";
import type { CreateGearTypeInput } from "#/features/gear/server/gear-fns";

export function useCreateGearType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGearTypeInput) =>
      createGearTypeFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: GEAR_TYPES_QUERY_KEY }),
          // Gear list rows surface the type name/prefix — refetch in case
          // a type rename happened on the same call site.
          queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
        ]);
      }
    },
  });
}
