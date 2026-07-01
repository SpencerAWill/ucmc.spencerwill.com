import { auditEventsQueryKey } from "#/features/audit/api/query-keys";
import type { AuditEventsFilters } from "#/features/audit/api/query-keys";
import { listAuditEventsFn } from "#/features/audit/server/audit-fns";

/**
 * Paginated audit-log feed for the `/audit` viewer. Filters and
 * pagination are part of the cache key so flipping any of them
 * cache-misses cleanly. Date bounds reach the server as ms timestamps
 * (`fromMs` inclusive, `toMs` exclusive); the route is responsible for
 * converting its ISO date search params into ms before calling.
 */
export function auditEventsQueryOptions(f: AuditEventsFilters) {
  return {
    queryKey: auditEventsQueryKey(f),
    queryFn: () =>
      listAuditEventsFn({
        data: {
          page: f.page,
          perPage: f.perPage,
          action: f.action ?? undefined,
          from: f.fromMs ?? undefined,
          to: f.toMs ?? undefined,
        },
      }),
  } as const;
}
