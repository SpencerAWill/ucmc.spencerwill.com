import { useMutation, useQueryClient } from "@tanstack/react-query";

import { GEAR_QUERY_KEY } from "#/features/gear/api/query-keys";
import { createGearFn } from "#/features/gear/server/gear-fns";
import type { CreateGearInput } from "#/features/gear/server/gear-fns";

export function useCreateGear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGearInput) => createGearFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY });
      }
    },
  });
}
