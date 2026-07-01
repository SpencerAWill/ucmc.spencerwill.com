import { useMutation, useQueryClient } from "@tanstack/react-query";

import { GEAR_TAGS_QUERY_KEY } from "#/features/gear/api/query-keys";
import { createGearTagFn } from "#/features/gear/server/gear-fns";
import type { CreateGearTagInput } from "#/features/gear/server/gear-fns";

export function useCreateGearTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGearTagInput) => createGearTagFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        await queryClient.invalidateQueries({
          queryKey: GEAR_TAGS_QUERY_KEY,
        });
      }
    },
  });
}
