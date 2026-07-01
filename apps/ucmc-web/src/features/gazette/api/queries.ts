import {
  GAZETTE_LIST_QUERY_KEY,
  gazetteIssueQueryKey,
} from "#/features/gazette/api/query-keys";
import {
  getGazetteIssueByPublicIdFn,
  getGazetteIssuesFn,
} from "#/features/gazette/server/gazette-fns";

/**
 * Bundled issue list for the /gazette list page. The route loader
 * prefetches this so SSR has the data baked in. Issues change at
 * most a few times per year, so a long staleTime is fine.
 */
export function gazetteListQueryOptions() {
  return {
    queryKey: GAZETTE_LIST_QUERY_KEY,
    queryFn: () => getGazetteIssuesFn(),
    staleTime: 5 * 60_000,
  } as const;
}

/**
 * Per-issue detail. Used by the /gazette/$publicId route's loader.
 */
export function gazetteIssueQueryOptions(publicId: string) {
  return {
    queryKey: gazetteIssueQueryKey(publicId),
    queryFn: () => getGazetteIssueByPublicIdFn({ data: { publicId } }),
    staleTime: 5 * 60_000,
  } as const;
}
