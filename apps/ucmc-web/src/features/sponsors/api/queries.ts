import { SPONSORS_CONTENT_QUERY_KEY } from "#/features/sponsors/api/query-keys";
import { getSponsorsContentFn } from "#/features/sponsors/server/sponsor-fns";

/**
 * Bundled /sponsors content. The route loader prefetches this so SSR has
 * the data baked in.
 *
 * **The payload is viewer-dependent** — it carries `memberPerk` only for
 * a holder of `public_sponsors:perks` — so this entry must never be
 * shared across identities. It isn't: the query cache is per browser
 * session and is rebuilt on sign-in / sign-out, and nothing caches
 * server-fn responses at the edge. A five-minute `staleTime` is fine
 * (the list changes a few times a year) but a cross-request cache here
 * would not be.
 */
export function sponsorsContentQueryOptions() {
  return {
    queryKey: SPONSORS_CONTENT_QUERY_KEY,
    queryFn: () => getSponsorsContentFn(),
    staleTime: 5 * 60_000,
  } as const;
}
