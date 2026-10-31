import type { ListRecordsFilter } from "#/features/conduct/server/limits";

/**
 * TanStack Query keys for the conduct feature. Every key sits under
 * `["conduct"]`, so one prefix invalidation refreshes records, reports
 * and a member's summary together.
 */
export const conductKeys = {
  all: ["conduct"] as const,
  records: (filter: ListRecordsFilter) =>
    ["conduct", "records", filter] as const,
  record: (publicId: string) => ["conduct", "record", publicId] as const,
  reports: (filter: Record<string, unknown> = {}) =>
    ["conduct", "reports", filter] as const,
  member: (userId: string) => ["conduct", "member", userId] as const,
  subjects: (q: string) => ["conduct", "subjects", q] as const,
  subject: (publicId: string) => ["conduct", "subject", publicId] as const,
  reportSubjects: (q: string) => ["conduct", "report-subjects", q] as const,
};

/**
 * The members feature's detail cache, which embeds a member's conduct
 * summary. Written as a literal because `features/conduct` cannot import
 * `features/members`; `MEMBERS_DETAIL_QUERY_KEY` is the same value.
 */
export const MEMBERS_DETAIL_PREFIX = ["members", "detail"] as const;
