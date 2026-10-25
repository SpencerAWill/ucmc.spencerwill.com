import { useMutation, useQueryClient } from "@tanstack/react-query";

import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import { syncSiteFeedbackIssuesFn } from "#/features/site-feedback/server/site-feedback-triage-fns";

/**
 * Manager: pull open/closed state for filed issues from GitHub now (the same
 * work the daily cron does). Resolves `{ ok: false, reason: "not_configured" }`
 * when GitHub isn't set up; GitHub errors throw, so read `error`.
 * Invalidates: every triage view (rail, last-synced time), the overview, and
 * `mine` (a closed issue resolves the submitter's report). Per-issue
 * `issue(id)` entries are not touched; the composer refetches on mount.
 */
export function useSyncSiteFeedbackIssues() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => syncSiteFeedbackIssuesFn(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.triageAll }),
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.overview }),
        queryClient.invalidateQueries({ queryKey: siteFeedbackKeys.mine }),
      ]);
    },
  });
}
