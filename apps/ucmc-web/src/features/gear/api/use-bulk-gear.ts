/**
 * Mutation hooks for the toolbar-driven bulk-select operations.
 * Co-located in one file because they share an invalidation contract
 * (every bulk mutation invalidates GEAR_QUERY_KEY plus the affected
 * detail keys would, but the toolbar doesn't know which details are
 * loaded — we just blow the list cache).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { GEAR_QUERY_KEY } from "#/features/gear/api/query-keys";
import {
  bulkAddGearItemTagsFn,
  bulkDeactivateGearFn,
  bulkSetGearItemConditionFn,
  bulkReactivateGearFn,
} from "#/features/gear/server/gear-fns";
import type { GearCondition } from "#/features/gear/server/gear-fns";

function useBulkGearMutation<TInput>(
  fn: (args: {
    data: TInput;
  }) => Promise<{ affected: number; skipped: number }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => fn({ data: input }),
    onSuccess: async (result) => {
      if (result.affected > 0) {
        await queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY });
      }
    },
  });
}

export function useBulkDeactivateGear() {
  return useBulkGearMutation<{
    publicIds: string[];
    status: "retired" | "lost" | "disposed";
    reason: string | null;
  }>(bulkDeactivateGearFn);
}

export function useBulkReactivateGear() {
  return useBulkGearMutation<{ publicIds: string[] }>(bulkReactivateGearFn);
}

export function useBulkSetGearCondition() {
  return useBulkGearMutation<{
    publicIds: string[];
    condition: GearCondition;
  }>(bulkSetGearItemConditionFn);
}

export function useBulkAddGearTags() {
  return useBulkGearMutation<{
    publicIds: string[];
    tagPublicIds: string[];
  }>(bulkAddGearItemTagsFn);
}
