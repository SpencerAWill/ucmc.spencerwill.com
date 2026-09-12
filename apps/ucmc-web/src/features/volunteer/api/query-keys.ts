/**
 * TanStack Query keys for the volunteer feature. /volunteer reads its
 * narrative, programs and both event bands as a single bundle, so one
 * cache entry covers the page and every mutation invalidates the same
 * key.
 */
export const VOLUNTEER_CONTENT_QUERY_KEY = ["volunteer", "content"] as const;
