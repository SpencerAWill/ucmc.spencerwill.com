import {
  MY_WAIVER_HISTORY_QUERY_KEY,
  MY_WAIVER_STATUS_QUERY_KEY,
  WAIVER_PENDING_QUEUE_QUERY_KEY,
  waiverHistoryForUserQueryKey,
} from "#/features/waivers/api/query-keys";
import {
  getMyCurrentWaiverStatusFn,
  listMembersNeedingAttestationFn,
  listMyWaiverHistoryFn,
  listWaiverHistoryForUserFn,
} from "#/features/waivers/server/waiver-fns";

// Re-export `WaiverStatus` for `features/auth/guards.ts` (the only
// other feature that reads waiver state, via `requireCurrentWaiver`).
// The shell itself stays out of the cross-feature ESLint allowlist
// because `import/no-restricted-paths` can't distinguish `import type`
// from value imports — allowlisting `server/waiver-fns.ts` would
// silently permit value-imports of runtime exports like
// `BULK_ATTEST_MAX`. Types ride through this api/ re-export instead.
// Routes can import the other shapes (`MemberNeedingAttestation`,
// `WaiverAttestationSummary`) from the shell directly — they're not
// gated by the cross-feature rule.
export type { WaiverStatus } from "#/features/waivers/server/waiver-fns";

/**
 * Caller's current-cycle waiver status (`null` if not attested).
 * Consumed by `/account/waiver` and the `requireCurrentWaiver` guard.
 */
export function myWaiverStatusQueryOptions() {
  return {
    queryKey: MY_WAIVER_STATUS_QUERY_KEY,
    queryFn: () => getMyCurrentWaiverStatusFn(),
  } as const;
}

/** Caller's full attestation history newest-first. */
export function myWaiverHistoryQueryOptions() {
  return {
    queryKey: MY_WAIVER_HISTORY_QUERY_KEY,
    queryFn: () => listMyWaiverHistoryFn(),
  } as const;
}

/** Officer queue: approved members lacking a current attestation. */
export function waiverPendingQueueQueryOptions() {
  return {
    queryKey: WAIVER_PENDING_QUEUE_QUERY_KEY,
    queryFn: () => listMembersNeedingAttestationFn(),
  } as const;
}

/** Officer-only: a specific member's full attestation history. */
export function waiverHistoryForUserQueryOptions(userId: string) {
  return {
    queryKey: waiverHistoryForUserQueryKey(userId),
    queryFn: () => listWaiverHistoryForUserFn({ data: { userId } }),
  } as const;
}
