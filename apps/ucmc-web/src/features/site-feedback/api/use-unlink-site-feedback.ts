import { useMutation, useQueryClient } from "@tanstack/react-query";

import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import type { SiteFeedbackUnlinkInput } from "#/features/site-feedback/server/limits";
import { unlinkSiteFeedbackFn } from "#/features/site-feedback/server/site-feedback-triage-fns";

/**
 * Manager: remove a not-yet-posted report from an issue.
 * Invalidates: every triage view, the overview counts, and this issue's
 * `issue(id)` and `related(id)`.
 */
export function useUnlinkSiteFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SiteFeedbackUnlinkInput) =>
      unlinkSiteFeedbackFn({ data }),
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
