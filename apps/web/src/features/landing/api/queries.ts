import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { getLandingContentFn } from "#/features/landing/server/landing-fns";

/**
 * Bundled landing-page content (settings + hero slides + FAQ + activities)
 * — the home page route loader prefetches this so SSR has the data baked
 * in. 60s staleTime keeps the page snappy across navigations without
 * hammering the server on every soft nav.
 */
export function landingContentQueryOptions() {
  return {
    queryKey: LANDING_CONTENT_QUERY_KEY,
    queryFn: () => getLandingContentFn(),
    staleTime: 60_000,
  } as const;
}
