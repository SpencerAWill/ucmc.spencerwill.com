import {
  LANDING_CONTENT_QUERY_KEY,
  pageHeroQueryKey,
} from "#/features/landing/api/query-keys";
import type { HeroPage } from "#/features/landing/lib/hero-pages";
import {
  getLandingContentFn,
  getPageHeroFn,
} from "#/features/landing/server/landing-fns";

/**
 * Bundled landing-page content (settings + hero slides + FAQ + activities
 * + officers) — the home page route loader prefetches this so SSR has the
 * data baked in. 60s staleTime keeps the page snappy across navigations
 * without hammering the server on every soft nav.
 */
export function landingContentQueryOptions() {
  return {
    queryKey: LANDING_CONTENT_QUERY_KEY,
    queryFn: () => getLandingContentFn(),
    staleTime: 60_000,
  } as const;
}

/**
 * One page's hero — copy plus slides. Same 60s staleTime as the bundled
 * landing read; a hero is the first thing painted on every public page,
 * so it's worth serving from cache across navigations.
 */
export function pageHeroQueryOptions(page: HeroPage) {
  return {
    queryKey: pageHeroQueryKey(page),
    queryFn: () => getPageHeroFn({ data: page }),
    staleTime: 60_000,
  } as const;
}
