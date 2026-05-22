import { HISTORY_CONTENT_QUERY_KEY } from "#/features/history/api/query-keys";
import { getHistoryContentFn } from "#/features/history/server/history-fns";

/**
 * Bundled /history content (past officers + honorary members). The
 * route loader prefetches this so SSR has the data baked in. Officers
 * change at most yearly and honorary inductees rarely, so a long
 * staleTime is fine.
 */
export function historyContentQueryOptions() {
  return {
    queryKey: HISTORY_CONTENT_QUERY_KEY,
    queryFn: () => getHistoryContentFn(),
    staleTime: 5 * 60_000,
  } as const;
}
