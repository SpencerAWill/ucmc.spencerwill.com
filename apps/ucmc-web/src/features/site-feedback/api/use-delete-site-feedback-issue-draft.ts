import { useMutation, useQueryClient } from "@tanstack/react-query";

import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import { deleteSiteFeedbackIssueDraftFn } from "#/features/site-feedback/server/site-feedback-triage-fns";

/**
 * Manager: delete a draft issue; its reports return to "New".
 * Invalidates: every triage view and the overview counts. The deleted issue's
 * own `issue(id)` and `related(id)` entries are removed rather than
 * invalidated, because a refetch of a deleted draft would only error.
 */
export function useDeleteSiteFeedbackIssueDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      deleteSiteFeedbackIssueDraftFn({ data: { id } }),
    onSuccess: async (_result, id) => {
      queryClient.removeQueries({ queryKey: siteFeedbackKeys.issue(id) });
      queryClient.removeQueries({ queryKey: siteFeedbackKeys.related(id) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.triageAll }),
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.overview }),
      ]);
    },
  });
}
