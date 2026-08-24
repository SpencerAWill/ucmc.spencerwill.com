/**
 * TanStack Query keys for the landing feature. Centralized so mutation
 * hooks and the read query reference the same source of truth.
 *
 * The whole landing page reads from a single bundled query, so there's
 * only one cache entry — every mutation invalidates it.
 */
export const LANDING_CONTENT_QUERY_KEY = ["landing", "content"] as const;

/**
 * Shared prefix for every landing cache entry. Hero mutations invalidate
 * this rather than one key: home's slides appear in both the bundled
 * content entry and its own page-hero entry, so a targeted invalidation
 * would always leave one of the two stale.
 */
export const LANDING_QUERY_PREFIX = ["landing"] as const;

/**
 * Per-page hero cache entries, under the same `["landing"]` prefix so a
 * hero mutation can invalidate every page's hero (and the bundled home
 * content) with one prefix invalidation. The slide editor writes to one
 * page at a time, but the bundled landing query also carries home's
 * slides — two entries for the same rows, so a targeted invalidation
 * would leave one of them stale.
 */
export const PAGE_HERO_QUERY_KEY = ["landing", "page-hero"] as const;

export function pageHeroQueryKey(page: string) {
  return [...PAGE_HERO_QUERY_KEY, page] as const;
}
