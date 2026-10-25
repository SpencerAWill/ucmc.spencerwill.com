import { useMutation, useQueryClient } from "@tanstack/react-query";

import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import type { SiteFeedbackDispositionInput } from "#/features/site-feedback/server/limits";
import { setSiteFeedbackDispositionFn } from "#/features/site-feedback/server/site-feedback-triage-fns";

/**
 * Manager: mark reports won't fix, duplicate, resolved or open again.
 * Invalidates: every triage view (rows move between chips) and the overview
 * counts.
 */
export function useSetSiteFeedbackDisposition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SiteFeedbackDispositionInput) =>
      setSiteFeedbackDispositionFn({ data }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.triageAll }),
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.overview }),
      ]);
    },
  });
}
