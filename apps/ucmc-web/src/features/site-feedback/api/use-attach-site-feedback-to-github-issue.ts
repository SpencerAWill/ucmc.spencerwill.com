import { useMutation, useQueryClient } from "@tanstack/react-query";

import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import type { SiteFeedbackAttachInput } from "#/features/site-feedback/server/limits";
import { attachSiteFeedbackToGithubIssueFn } from "#/features/site-feedback/server/site-feedback-triage-fns";

/**
 * Manager: attach reports to an existing GitHub issue by number. Resolves
 * with a `GithubActionResult`; `ok: false` carries a `message` to show.
 * Invalidates: every triage view, the overview, the submitter's `mine` list
 * (their report now reads "Tracked in #N"), and on success the attached
 * issue's `issue(id)` and `related(id)`.
 */
export function useAttachSiteFeedbackToGithubIssue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SiteFeedbackAttachInput) =>
      attachSiteFeedbackToGithubIssueFn({ data }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.triageAll }),
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.overview }),
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.mine }),
        ...(result.ok
          ? [
              queryClient.invalidateQueries({
                queryKey: siteFeedbackKeys.issue(result.issueId),
              }),
              queryClient.invalidateQueries({
                queryKey: siteFeedbackKeys.related(result.issueId),
              }),
            ]
          : []),
      ]);
    },
  });
}
