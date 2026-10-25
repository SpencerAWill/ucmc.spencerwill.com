import { useMutation, useQueryClient } from "@tanstack/react-query";

import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import type { SiteFeedbackIssueDraftCreateInput } from "#/features/site-feedback/server/limits";
import { createSiteFeedbackIssueDraftFn } from "#/features/site-feedback/server/site-feedback-triage-fns";

/**
 * Manager: start a draft issue from the selected reports. Resolves with the
 * new draft's id so the caller can open the composer.
 * Invalidates: every triage view (the reports move to "In draft", the rail
 * gains a draft) and the overview counts.
 */
export function useCreateSiteFeedbackIssueDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SiteFeedbackIssueDraftCreateInput) =>
      createSiteFeedbackIssueDraftFn({ data }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.triageAll }),
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.overview }),
      ]);
    },
  });
}
