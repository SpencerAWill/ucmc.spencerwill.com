import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_DETAIL_PREFIX,
  conductKeys,
} from "#/features/conduct/api/query-keys";
import type { CreateRecordInput } from "#/features/conduct/server/limits";
import { createConductRecordFn } from "#/features/conduct/server/record-fns";

/**
 * Opens a conduct record. Invalidates every conduct query and the members detail cache
 * (it embeds a member's conduct summary). The caller owns toasts.
 */
export function useCreateConductRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateRecordInput) => createConductRecordFn({ data }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: conductKeys.all }),
        queryClient.invalidateQueries({ queryKey: MEMBERS_DETAIL_PREFIX }),
      ]);
    },
  });
}
