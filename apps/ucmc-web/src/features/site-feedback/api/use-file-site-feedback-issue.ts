import { useMutation, useQueryClient } from "@tanstack/react-query";

import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import { fileSiteFeedbackIssueFn } from "#/features/site-feedback/server/site-feedback-triage-fns";

/**
 * Manager: file a draft on GitHub. Resolves with a `GithubActionResult`;
 * `ok: false` carries a `message` to show.
 * Invalidates: every triage view, the overview, the submitters' `mine` list
 * (their reports become "Tracked"), and this issue's `issue(id)` and
 * `related(id)`. Invalidates on failure too: a failed attempt can still have
 * changed the claim state.
 */
export function useFileSiteFeedbackIssue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fileSiteFeedbackIssueFn({ data: { id } }),
    onSettled: async (_result, _error, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.triageAll }),
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.overview }),
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.mine }),
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.issue(id) }),
        queryClient.invalidateQueries({
          queryKey: siteFeedbackKeys.related(id),
        }),
      ]);
    },
  });
}
