import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_DETAIL_QUERY_KEY,
  GEAR_MODELS_QUERY_KEY,
  GEAR_QUERY_KEY,
} from "#/features/gear/api/query-keys";
import { updateGearModelFn } from "#/features/gear/server/gear-fns";
import type { UpdateGearModelInput } from "#/features/gear/server/models-actions.server";

export function useUpdateGearModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGearModelInput) =>
      updateGearModelFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: GEAR_MODELS_QUERY_KEY }),
          // Item rows carry the model's name, brand and MSRP, so a
          // rename that stopped at the model list would leave every
          // card showing the old one.
          queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
          // …and so does every open detail page. A rename that stopped
          // at the lists would leave an open /gear/$publicId tab
          // showing the old product name.
          queryClient.invalidateQueries({ queryKey: GEAR_DETAIL_QUERY_KEY }),
        ]);
      }
    },
  });
}
