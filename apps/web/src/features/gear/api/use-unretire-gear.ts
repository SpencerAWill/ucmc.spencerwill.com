import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_QUERY_KEY,
  gearDetailQueryKey,
} from "#/features/gear/api/query-keys";
import { unretireGearFn } from "#/features/gear/server/gear-fns";

export function useUnretireGear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { publicId: string }) =>
      unretireGearFn({ data: input }),
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
