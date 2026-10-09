/**
 * TanStack Query keys for the analytics dashboard.
 *
 * Every key carries the season it was read for, so changing the season
 * control cache-misses cleanly rather than showing the previous
 * season's numbers under the new label. `null` means "whatever the
 * server decides is current" and is a distinct cache entry from the
 * explicit label for the same season on purpose: the two converge in
 * value but not in lifetime, and pinning "current" to a resolved label
 * client-side would go stale at the August rollover without a reload.
 */
export const ANALYTICS_QUERY_KEY = ["analytics"] as const;

export function platformAnalyticsQueryKey(season: string | null) {
  return [...ANALYTICS_QUERY_KEY, "platform", season] as const;
}

export function complianceAnalyticsQueryKey(season: string | null) {
  return [...ANALYTICS_QUERY_KEY, "compliance", season] as const;
}

export function gearAnalyticsQueryKey(season: string | null) {
  return [...ANALYTICS_QUERY_KEY, "gear", season] as const;
}

export function activityAnalyticsQueryKey(season: string | null) {
  return [...ANALYTICS_QUERY_KEY, "activity", season] as const;
}
