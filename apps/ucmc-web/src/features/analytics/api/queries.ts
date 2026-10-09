import { platformAnalyticsQueryKey } from "#/features/analytics/api/query-keys";
import { platformAnalyticsFn } from "#/features/analytics/server/analytics-fns";

/**
 * Free-tier headroom, cost and email volume for one season.
 *
 * Read-only: the analytics feature has no mutations, so there are no
 * `use-*.ts` invalidation hooks under `api/` and none is owed.
 */
export function platformAnalyticsQueryOptions(season: string | null) {
  return {
    queryKey: platformAnalyticsQueryKey(season),
    queryFn: () => platformAnalyticsFn({ data: season ? { season } : {} }),
  } as const;
}
