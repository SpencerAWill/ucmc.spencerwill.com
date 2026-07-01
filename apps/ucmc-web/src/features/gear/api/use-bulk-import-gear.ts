import { useMutation, useQueryClient } from "@tanstack/react-query";

import { GEAR_QUERY_KEY } from "#/features/gear/api/query-keys";
import { bulkImportGearFn } from "#/features/gear/server/gear-fns";
import type { BulkImportInput } from "#/features/gear/server/gear-fns";

/**
 * Bulk-creates many gear rows in one request. Returns `{ created,
 * skipped }`; the call site renders both. Invalidates the gear list as
 * long as at least one row landed (skipped-only imports leave the list
 * stable, no need to refetch).
 */
export function useBulkImportGear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkImportInput) => bulkImportGearFn({ data: input }),
    onSuccess: async (result) => {
      if (result.created.length > 0) {
        await queryClient.invalidateQueries({ queryKey: GEAR_QUERY_KEY });
      }
    },
  });
}
