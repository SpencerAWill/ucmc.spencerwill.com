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

// Re-export the shapes consumers need from the server shell so the
// shell itself stays out of the cross-feature ESLint allowlist.
// `import/no-restricted-paths` can't distinguish `import type` from
// value imports, so allowlisting `server/waiver-fns.ts` would silently
// permit value imports of runtime exports like `BULK_ATTEST_MAX`. The
// api/ layer is the feature's public surface; types travel through it.
export type {
  MemberNeedingAttestation,
  WaiverAttestationSummary,
  WaiverStatus,
} from "#/features/waivers/server/waiver-fns";

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
