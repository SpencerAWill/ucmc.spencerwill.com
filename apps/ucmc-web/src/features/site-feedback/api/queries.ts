import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import {
  listAllSiteFeedbackFn,
  listMySiteFeedbackFn,
} from "#/features/site-feedback/server/site-feedback-fns";

/**
 * The signed-in member's own submissions, newest-first. 30s staleTime so
 * a fresh submit visibly lands without us hammering the server on every
 * navigation back to /feedback.
 */
export function mySiteFeedbackQueryOptions() {
  return {
    queryKey: siteFeedbackKeys.mine,
    queryFn: () => listMySiteFeedbackFn(),
    staleTime: 30_000,
  } as const;
}

/**
 * Admin triage list: every submission across all users, newest-first.
 * Pass `{ enabled }` so non-managers don't fire a server fn that would
 * 403 anyway. Same staleness as `mySiteFeedbackQueryOptions`.
 */
export function allSiteFeedbackQueryOptions(options: { enabled: boolean }) {
  return {
    queryKey: siteFeedbackKeys.list,
    queryFn: () => listAllSiteFeedbackFn(),
    staleTime: 30_000,
    enabled: options.enabled,
  } as const;
}
