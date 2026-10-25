import { useMutation, useQueryClient } from "@tanstack/react-query";

import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import { updateSiteFeedbackStatusFn } from "#/features/site-feedback/server/site-feedback-fns";
import type { SiteFeedbackStatusUpdateInput } from "#/features/site-feedback/server/limits";

/**
 * Admin-only: change a feedback entry's triage status. Invalidates the
 * triage list so the row reflects the new status. The submitter's
 * "my feedback" list isn't invalidated here because admins don't
 * typically own the submissions they triage; the staleTime is short
 * enough (30s) that submitters see updates on next navigation anyway.
 */
export function useUpdateSiteFeedbackStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SiteFeedbackStatusUpdateInput) =>
      updateSiteFeedbackStatusFn({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: siteFeedbackKeys.list,
      });
    },
  });
}
