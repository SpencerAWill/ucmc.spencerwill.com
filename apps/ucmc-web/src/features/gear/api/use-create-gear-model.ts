import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_MODELS_QUERY_KEY,
  GEAR_QUERY_KEY,
} from "#/features/gear/api/query-keys";
import { createGearModelFn } from "#/features/gear/server/gear-fns";
import type { CreateGearModelInput } from "#/features/gear/server/models-actions.server";

export function useCreateGearModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGearModelInput) =>
      createGearModelFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        await Promise.all([
          // Every type-scoped model list is invalidated, not just the one
          // in view: the picker keys by type, and the officer may have
          // switched types between opening the form and saving.
          queryClient.invalidateQueries({ queryKey: GEAR_MODELS_QUERY_KEY }),
          // Item rows render the model's name and brand.
          queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
        ]);
      }
    },
  });
}
