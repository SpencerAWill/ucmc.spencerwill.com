import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_QUERY_KEY,
  gearDetailQueryKey,
} from "#/features/gear/api/query-keys";
import { retireGearFn } from "#/features/gear/server/gear-fns";

export function useRetireGear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { publicId: string; reason: string | null }) =>
      retireGearFn({ data: input }),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
        queryClient.invalidateQueries({
          queryKey: gearDetailQueryKey(variables.publicId),
        }),
      ]);
    },
  });
}
