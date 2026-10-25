import { useMutation, useQueryClient } from "@tanstack/react-query";

import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import { postPendingSiteFeedbackReportsFn } from "#/features/site-feedback/server/site-feedback-triage-fns";

/**
 * Manager: post reports linked after filing as comments on the GitHub issue.
 * Resolves with a `GithubActionResult`; `ok: false` carries a `message`.
 * Invalidates: every triage view, the overview, `mine`, and this issue's
 * `issue(id)` and `related(id)`. Also on failure, since a partial post can
 * still mark some reports as posted.
 */
export function usePostPendingSiteFeedbackReports() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (issueId: string) =>
      postPendingSiteFeedbackReportsFn({ data: { issueId } }),
    onSettled: async (_result, _error, issueId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.triageAll }),
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.overview }),
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.mine }),
        queryClient.invalidateQueries({
          queryKey: siteFeedbackKeys.issue(issueId),
        }),
        queryClient.invalidateQueries({
          queryKey: siteFeedbackKeys.related(issueId),
        }),
      ]);
    },
  });
}
