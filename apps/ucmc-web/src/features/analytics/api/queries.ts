import {
  activityAnalyticsQueryKey,
  complianceAnalyticsQueryKey,
  gearAnalyticsQueryKey,
  membershipAnalyticsQueryKey,
  platformAnalyticsQueryKey,
} from "#/features/analytics/api/query-keys";
import {
  activityAnalyticsFn,
  complianceAnalyticsFn,
  gearAnalyticsFn,
  membershipAnalyticsFn,
  platformAnalyticsFn,
} from "#/features/analytics/server/analytics-fns";

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

/** Waiver coverage, attestation timing, the RSO minimum and archive gaps. */
export function complianceAnalyticsQueryOptions(season: string | null) {
  return {
    queryKey: complianceAnalyticsQueryKey(season),
    queryFn: () => complianceAnalyticsFn({ data: season ? { season } : {} }),
  } as const;
}

/** Utilisation, overdue aging, loan duration and inspection standing. */
export function gearAnalyticsQueryOptions(season: string | null) {
  return {
    queryKey: gearAnalyticsQueryKey(season),
    queryFn: () => gearAnalyticsFn({ data: season ? { season } : {} }),
  } as const;
}

/** Events by kind on the season axis, cancellations, and volunteer service. */
export function activityAnalyticsQueryOptions(season: string | null) {
  return {
    queryKey: activityAnalyticsQueryKey(season),
    queryFn: () => activityAnalyticsFn({ data: season ? { season } : {} }),
  } as const;
}

/** The status funnel, joins on the season axis, retention and tenure. */
export function membershipAnalyticsQueryOptions(season: string | null) {
  return {
    queryKey: membershipAnalyticsQueryKey(season),
    queryFn: () => membershipAnalyticsFn({ data: season ? { season } : {} }),
  } as const;
}
