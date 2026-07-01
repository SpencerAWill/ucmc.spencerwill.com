import {
  CLUB_FEEDBACK_LIST_QUERY_KEY,
  CLUB_FEEDBACK_MY_QUERY_KEY,
} from "#/features/club-feedback/api/query-keys";
import {
  listAllClubFeedbackFn,
  listMyClubFeedbackFn,
} from "#/features/club-feedback/server/club-feedback-fns";

/**
 * The signed-in member's own club-feedback submissions, newest-first.
 * 30 s staleTime so a fresh submit visibly lands without us hammering
 * the server on every navigation back to the page.
 */
export function myClubFeedbackQueryOptions() {
  return {
    queryKey: CLUB_FEEDBACK_MY_QUERY_KEY,
    queryFn: () => listMyClubFeedbackFn(),
    staleTime: 30_000,
  } as const;
}

/**
 * Admin triage list: every club-feedback submission across all users,
 * newest-first. Pass `{ enabled }` so non-managers don't fire a server
 * fn that would 403 anyway. Same staleness as `myClubFeedbackQueryOptions`.
 */
export function allClubFeedbackQueryOptions(options: { enabled: boolean }) {
  return {
    queryKey: CLUB_FEEDBACK_LIST_QUERY_KEY,
    queryFn: () => listAllClubFeedbackFn(),
    staleTime: 30_000,
    enabled: options.enabled,
  } as const;
}
