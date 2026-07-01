/**
 * TanStack Query keys for the waivers feature. Centralized so query
 * options and the mutation hooks that invalidate them never drift —
 * a key mismatch would leave stale UI on screen after an attestation.
 *
 * The member's own status + history land under "account", the officer
 * queue under "members" so the cache trees mirror the route trees that
 * consume them.
 */
export const MY_WAIVER_STATUS_QUERY_KEY = [
  "account",
  "waiver",
  "status",
] as const;
export const MY_WAIVER_HISTORY_QUERY_KEY = [
  "account",
  "waiver",
  "history",
] as const;
export const WAIVER_PENDING_QUEUE_QUERY_KEY = [
  "members",
  "waivers",
  "pending",
] as const;
export const waiverHistoryForUserQueryKey = (userId: string) =>
  ["members", "waivers", "history", userId] as const;
