import { useMutation, useQueryClient } from "@tanstack/react-query";

import { conductKeys } from "#/features/conduct/api/query-keys";
import type { DismissReportArgs } from "#/features/conduct/server/limits";
import { dismissConductReportFn } from "#/features/conduct/server/report-fns";

/**
 * Dismisses a conduct report. Invalidates every conduct query (the list and
 * any record that cites it). The caller owns toasts.
 */
export function useDismissConductReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DismissReportArgs) => dismissConductReportFn({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: conductKeys.all });
    },
  });
}
