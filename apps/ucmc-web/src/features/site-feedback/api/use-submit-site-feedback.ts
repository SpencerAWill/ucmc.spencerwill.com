import { useMutation, useQueryClient } from "@tanstack/react-query";

import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import { submitSiteFeedbackFn } from "#/features/site-feedback/server/site-feedback-fns";
import type { SiteFeedbackInput } from "#/features/site-feedback/server/limits";

/**
 * Submit a feedback entry. On success invalidates the submitter's own
 * list. Caller wires its own onSuccess/onError for toast
 * messaging — the hook returns the bare mutation.
 */
export function useSubmitSiteFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SiteFeedbackInput) => submitSiteFeedbackFn({ data }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.mine }),
      ]);
    },
  });
}
