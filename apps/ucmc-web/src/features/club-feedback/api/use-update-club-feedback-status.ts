import { useMutation, useQueryClient } from "@tanstack/react-query";

import { CLUB_FEEDBACK_LIST_QUERY_KEY } from "#/features/club-feedback/api/query-keys";
import { updateClubFeedbackStatusFn } from "#/features/club-feedback/server/club-feedback-fns";
import type { ClubFeedbackStatusUpdateInput } from "#/features/club-feedback/server/limits";

/**
 * Admin-only: change a club-feedback entry's triage status. Invalidates
 * the admin list so the row reflects the new status. The submitter's
 * "my submissions" list isn't invalidated here because managers don't
 * typically own the submissions they triage; the staleTime is short
 * enough (30 s) that submitters see updates on next navigation anyway.
 */
export function useUpdateClubFeedbackStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ClubFeedbackStatusUpdateInput) =>
      updateClubFeedbackStatusFn({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: CLUB_FEEDBACK_LIST_QUERY_KEY,
      });
    },
  });
}
