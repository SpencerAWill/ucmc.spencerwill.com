import { useMutation, useQueryClient } from "@tanstack/react-query";

import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import type { SiteFeedbackQuoteUpdateInput } from "#/features/site-feedback/server/limits";
import { updateSiteFeedbackQuoteFn } from "#/features/site-feedback/server/site-feedback-triage-fns";

/**
 * Manager: edit the quoted text of a not-yet-posted report on an issue.
 * Invalidates: every triage view, the overview counts, and this issue's
 * `issue(id)` and `related(id)`.
 */
export function useUpdateSiteFeedbackQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SiteFeedbackQuoteUpdateInput) =>
      updateSiteFeedbackQuoteFn({ data }),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.triageAll }),
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.overview }),
        queryClient.invalidateQueries({
          queryKey: siteFeedbackKeys.issue(variables.issueId),
        }),
        queryClient.invalidateQueries({
          queryKey: siteFeedbackKeys.related(variables.issueId),
        }),
      ]);
    },
  });
}
