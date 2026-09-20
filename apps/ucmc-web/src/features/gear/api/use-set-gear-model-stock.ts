import { useMutation, useQueryClient } from "@tanstack/react-query";

import { GEAR_MODELS_QUERY_KEY } from "#/features/gear/api/query-keys";
import { setGearModelStockFn } from "#/features/gear/server/gear-fns";
import type { SetGearModelStockInput } from "#/features/gear/server/models-actions.server";

export function useSetGearModelStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetGearModelStockInput) =>
      setGearModelStockFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        // The models prefix covers both the officer list (which renders
        // the buckets) and browse-by-model (whose `takeable` is derived
        // from serviceable stock). Item queries are untouched on
        // purpose: a counted model has no item rows to go stale.
        await queryClient.invalidateQueries({
          queryKey: GEAR_MODELS_QUERY_KEY,
        });
      }
    },
  });
}
