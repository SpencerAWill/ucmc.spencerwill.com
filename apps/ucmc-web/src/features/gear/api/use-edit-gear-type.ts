import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_QUERY_KEY,
  GEAR_TYPES_QUERY_KEY,
} from "#/features/gear/api/query-keys";
import { editGearTypeFn } from "#/features/gear/server/gear-fns";
import type { EditGearTypeInput } from "#/features/gear/server/gear-fns";

export function useEditGearType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EditGearTypeInput) => editGearTypeFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: GEAR_TYPES_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
        ]);
      }
    },
  });
}
