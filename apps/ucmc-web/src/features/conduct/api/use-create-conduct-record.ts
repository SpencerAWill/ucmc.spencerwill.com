import { useMutation, useQueryClient } from "@tanstack/react-query";

import { MEMBERS_PREFIX, conductKeys } from "#/features/conduct/api/query-keys";
import type { CreateRecordInput } from "#/features/conduct/server/limits";
import { createConductRecordFn } from "#/features/conduct/server/record-fns";

/**
 * Opens a conduct record. Invalidates every conduct query and every
 * members cache (the detail embeds a member's conduct summary, and a
 * termination deactivates the subject). On settle, not success: a
 * termination whose deactivation failed has still saved its record. The
 * caller owns toasts.
 */
export function useCreateConductRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateRecordInput) => createConductRecordFn({ data }),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: conductKeys.all }),
        queryClient.invalidateQueries({ queryKey: MEMBERS_PREFIX }),
      ]);
    },
  });
}
