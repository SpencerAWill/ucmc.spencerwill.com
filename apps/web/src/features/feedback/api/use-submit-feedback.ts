import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  FEEDBACK_LIST_QUERY_KEY,
  FEEDBACK_MY_QUERY_KEY,
} from "#/features/feedback/api/query-keys";
import { submitFeedbackFn } from "#/features/feedback/server/feedback-fns";
import type { FeedbackInput } from "#/features/feedback/server/limits";

/**
 * Submit a feedback entry. On success invalidates the submitter's own
 * list and the admin triage list (so admins viewing the page see the
 * new row appear). Caller wires its own onSuccess/onError for toast
 * messaging — the hook returns the bare mutation.
 */
export function useSubmitFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: FeedbackInput) => submitFeedbackFn({ data }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: FEEDBACK_MY_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: FEEDBACK_LIST_QUERY_KEY }),
      ]);
    },
  });
}
