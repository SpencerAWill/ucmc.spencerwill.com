/**
 * TanStack Query keys for the audit-log viewer. The audit log is
 * read-only with one caller today (the `/audit` route's `useQuery`),
 * so this helper isn't aligning with an invalidator yet — it exists to
 * keep the filter shape colocated with the key so any future caller
 * (banner badge, prefetch on hover, write that needs to invalidate)
 * can reuse the same construction without rederiving it. Keys are
 * reactive to every server-side filter: action type, date range, and
 * pagination — so flipping a filter cache-misses cleanly instead of
 * returning a stale page.
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
