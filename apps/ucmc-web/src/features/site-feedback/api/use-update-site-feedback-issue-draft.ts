import { useMutation, useQueryClient } from "@tanstack/react-query";

import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import type { SiteFeedbackIssueDraftUpdateInput } from "#/features/site-feedback/server/limits";
import { updateSiteFeedbackIssueDraftFn } from "#/features/site-feedback/server/site-feedback-triage-fns";

/**
 * Manager: save a draft's title, summary and labels (the composer autosaves).
 * Resolves with `{ ok: false, reason }` on a conflict or a non-draft rather
 * than throwing, so the caller can show the conflict state.
 * Invalidates: only the issue itself and the triage views (the rail shows the
 * title). Deliberately NOT the overview or related queries, so an autosave
 * doesn't refetch the page on every pause in typing.
 */
export function useUpdateSiteFeedbackIssueDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SiteFeedbackIssueDraftUpdateInput) =>
      updateSiteFeedbackIssueDraftFn({ data }),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: siteFeedbackKeys.issue(variables.id),
        }),
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.triageAll }),
      ]);
    },
  });
}
