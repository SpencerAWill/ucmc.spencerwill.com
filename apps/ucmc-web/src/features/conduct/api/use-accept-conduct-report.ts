import { useMutation, useQueryClient } from "@tanstack/react-query";

import { conductKeys } from "#/features/conduct/api/query-keys";
import type { AcceptReportArgs } from "#/features/conduct/server/limits";
import { acceptConductReportFn } from "#/features/conduct/server/report-fns";

/**
 * Accepts a conduct report. Invalidates every conduct query (the list and
 * any record that cites it). The caller owns toasts.
 */
export function useAcceptConductReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AcceptReportArgs) => acceptConductReportFn({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: conductKeys.all });
    },
  });
}
