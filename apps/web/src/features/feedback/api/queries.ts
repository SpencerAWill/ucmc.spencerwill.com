import {
  FEEDBACK_LIST_QUERY_KEY,
  FEEDBACK_MY_QUERY_KEY,
} from "#/features/feedback/api/query-keys";
import {
  listAllFeedbackFn,
  listMyFeedbackFn,
} from "#/features/feedback/server/feedback-fns";

/**
 * The signed-in member's own submissions, newest-first. 30s staleTime so
 * a fresh submit visibly lands without us hammering the server on every
 * navigation back to /feedback.
 */
export function myFeedbackQueryOptions() {
  return {
    queryKey: FEEDBACK_MY_QUERY_KEY,
    queryFn: () => listMyFeedbackFn(),
    staleTime: 30_000,
  } as const;
}

/**
 * Admin triage list: every submission across all users, newest-first.
 * Pass `{ enabled }` so non-managers don't fire a server fn that would
 * 403 anyway. Same staleness as `myFeedbackQueryOptions`.
 */
export function allFeedbackQueryOptions(options: { enabled: boolean }) {
  return {
    queryKey: FEEDBACK_LIST_QUERY_KEY,
    queryFn: () => listAllFeedbackFn(),
    staleTime: 30_000,
    enabled: options.enabled,
  } as const;
}
