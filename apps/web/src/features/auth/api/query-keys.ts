/**
 * TanStack Query keys for the auth feature. Centralized here so mutation
 * hooks and query options reference the same source of truth — a key
 * mismatch between a query and the mutation that invalidates it would
 * silently leave stale UI on screen.
 */
export const SESSION_QUERY_KEY = ["auth", "session"] as const;

export const PROFILE_QUERY_KEY = ["account", "profile"] as const;

export const PASSKEY_LIST_QUERY_KEY = ["account", "passkeys"] as const;

// Waiver attestation — the member's own status + history land under
// "account", the officer queue under "members" so the cache trees mirror
// the route trees that consume them.
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
