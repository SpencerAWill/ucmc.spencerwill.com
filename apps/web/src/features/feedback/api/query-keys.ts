/**
 * TanStack Query keys for the feedback feature. Centralized so mutation
 * hooks and query options reference the same source of truth — mismatches
 * between the key a query reads and the key a mutation invalidates would
 * silently leave stale UI on screen.
 */
export const FEEDBACK_MY_QUERY_KEY = ["feedback", "my"] as const;

export const FEEDBACK_LIST_QUERY_KEY = ["feedback", "list"] as const;
