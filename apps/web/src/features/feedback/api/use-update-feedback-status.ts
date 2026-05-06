import { useMutation, useQueryClient } from "@tanstack/react-query";

import { FEEDBACK_LIST_QUERY_KEY } from "#/features/feedback/api/query-keys";
import { updateFeedbackStatusFn } from "#/features/feedback/server/feedback-fns";
import type { FeedbackStatusUpdateInput } from "#/features/feedback/server/limits";

/**
 * Admin-only: change a feedback entry's triage status. Invalidates the
 * triage list so the row reflects the new status. The submitter's
 * "my feedback" list isn't invalidated here because admins don't
 * typically own the submissions they triage; the staleTime is short
 * enough (30s) that submitters see updates on next navigation anyway.
 */
export function useUpdateFeedbackStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: FeedbackStatusUpdateInput) =>
      updateFeedbackStatusFn({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: FEEDBACK_LIST_QUERY_KEY,
      });
    },
  });
}
