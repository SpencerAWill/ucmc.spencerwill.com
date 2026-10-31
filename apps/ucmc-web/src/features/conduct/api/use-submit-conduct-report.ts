import { useMutation, useQueryClient } from "@tanstack/react-query";

import { conductKeys } from "#/features/conduct/api/query-keys";
import type { SubmitReportInput } from "#/features/conduct/server/limits";
import { submitConductReportFn } from "#/features/conduct/server/report-fns";

/**
 * Files a conduct report. The reporter has no list of their own to
 * refresh; invalidating the conduct queries keeps an exec member's open
 * reports tab current. The caller owns the confirmation.
 */
export function useSubmitConductReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SubmitReportInput) => submitConductReportFn({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: conductKeys.all });
    },
  });
}
