import { useMutation, useQueryClient } from "@tanstack/react-query";

import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import type { SiteFeedbackLinkInput } from "#/features/site-feedback/server/limits";
import { linkSiteFeedbackFn } from "#/features/site-feedback/server/site-feedback-triage-fns";

/**
 * Manager: add reports to an existing draft or filed issue.
 * Invalidates: every triage view, the overview counts, and this issue's
 * `issue(id)` and `related(id)`.
 */
export function useLinkSiteFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SiteFeedbackLinkInput) => linkSiteFeedbackFn({ data }),
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
