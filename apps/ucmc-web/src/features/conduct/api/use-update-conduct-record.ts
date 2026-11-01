import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_DETAIL_PREFIX,
  conductKeys,
} from "#/features/conduct/api/query-keys";
import type { UpdateRecordInput } from "#/features/conduct/server/limits";
import { updateConductRecordFn } from "#/features/conduct/server/record-fns";

/**
 * Edits a record's internal notes. Invalidates every conduct query and the members detail cache
 * (it embeds a member's conduct summary). The caller owns toasts.
 */
export function useUpdateConductRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateRecordInput) => updateConductRecordFn({ data }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: conductKeys.all }),
        queryClient.invalidateQueries({ queryKey: MEMBERS_DETAIL_PREFIX }),
      ]);
    },
  });
}
