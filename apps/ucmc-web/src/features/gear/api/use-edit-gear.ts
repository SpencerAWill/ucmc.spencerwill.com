import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_QUERY_KEY,
  gearDetailQueryKey,
} from "#/features/gear/api/query-keys";
import { editGearFn } from "#/features/gear/server/gear-fns";
import type { EditGearInput } from "#/features/gear/server/gear-fns";

export function useEditGear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EditGearInput) => editGearFn({ data: input }),
    onSuccess: async (result, variables) => {
      if (result.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
          queryClient.invalidateQueries({
            queryKey: gearDetailQueryKey(variables.publicId),
          }),
        ]);
      }
    },
  });
}
