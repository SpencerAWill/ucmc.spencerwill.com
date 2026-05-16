import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  CLUB_FEEDBACK_LIST_QUERY_KEY,
  CLUB_FEEDBACK_MY_QUERY_KEY,
} from "#/features/club-feedback/api/query-keys";
import { submitClubFeedbackFn } from "#/features/club-feedback/server/club-feedback-fns";
import type { ClubFeedbackInput } from "#/features/club-feedback/server/limits";

/**
 * Submit a club-feedback entry. On success invalidates the submitter's
 * own list and the admin triage list so both views reflect the new row.
 * Caller wires its own onSuccess/onError for toast messaging — the hook
 * returns the bare mutation.
 */
export function useSubmitClubFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ClubFeedbackInput) => submitClubFeedbackFn({ data }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: CLUB_FEEDBACK_MY_QUERY_KEY,
        }),
        queryClient.invalidateQueries({
          queryKey: CLUB_FEEDBACK_LIST_QUERY_KEY,
        }),
      ]);
    },
  });
}
