import { VOLUNTEER_CONTENT_QUERY_KEY } from "#/features/volunteer/api/query-keys";
import { getVolunteerContentFn } from "#/features/volunteer/server/volunteer-fns";

/**
 * Bundled /volunteer content. The route loader prefetches this so SSR
 * has the data baked in.
 *
 * `staleTime` is deliberately short compared with /history's five
 * minutes: the upcoming/past split is computed server-side against the
 * current day, so a long-lived cache entry would keep an outing in
 * "Coming up" after midnight has moved it to the archive.
 */
export function volunteerContentQueryOptions() {
  return {
    queryKey: VOLUNTEER_CONTENT_QUERY_KEY,
    queryFn: () => getVolunteerContentFn(),
    staleTime: 60_000,
  } as const;
}
