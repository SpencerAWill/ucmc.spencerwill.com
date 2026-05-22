/**
 * TanStack Query keys for the history feature. The /history page reads
 * past officers + honorary members as a single bundle, so one cache
 * entry is enough.
 */
export const HISTORY_CONTENT_QUERY_KEY = ["history", "content"] as const;
