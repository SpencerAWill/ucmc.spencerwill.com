/**
 * TanStack Query keys for the landing feature. Centralized so mutation
 * hooks and the read query reference the same source of truth.
 *
 * The whole landing page reads from a single bundled query, so there's
 * only one cache entry — every mutation invalidates it.
 */
export const LANDING_CONTENT_QUERY_KEY = ["landing", "content"] as const;
