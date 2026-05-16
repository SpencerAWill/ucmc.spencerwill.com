/**
 * TanStack Query keys for the club-feedback feature. Centralized so
 * mutation hooks and query options share one source of truth — a
 * mismatch between read and invalidation key would silently leave
 * stale UI on screen.
 */
export const CLUB_FEEDBACK_MY_QUERY_KEY = ["club-feedback", "my"] as const;

export const CLUB_FEEDBACK_LIST_QUERY_KEY = ["club-feedback", "list"] as const;
