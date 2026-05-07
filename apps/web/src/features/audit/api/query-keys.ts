/**
 * TanStack Query keys for the audit-log viewer. Centralized so the
 * filter-aware key shape never drifts between the route's loader and
 * its `useQuery` call. Keys are reactive to every server-side filter:
 * action type, date range, and pagination — so flipping a filter
 * cache-misses cleanly instead of returning a stale page.
 */
import type { AuditAction } from "#/features/audit/server/audit-fns";

export interface AuditEventsFilters {
  action: AuditAction | null;
  fromMs: number | null;
  toMs: number | null;
  page: number;
  perPage: number;
}

export function auditEventsQueryKey(f: AuditEventsFilters) {
  return [
    "audit-events",
    f.action,
    f.fromMs,
    f.toMs,
    f.page,
    f.perPage,
  ] as const;
}
