import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MY_WAIVER_HISTORY_QUERY_KEY,
  MY_WAIVER_STATUS_QUERY_KEY,
  WAIVER_PENDING_QUEUE_QUERY_KEY,
  waiverHistoryForUserQueryKey,
} from "#/features/auth/api/query-keys";
import {
  attestWaiverFn,
  bulkAttestWaiversFn,
  revokeWaiverAttestationFn,
} from "#/features/auth/server/waiver-fns";

/**
 * Officer attests one member's paper waiver for the current cycle.
 * Invalidates the attesting officer's view of the queue plus the
 * target's status + history caches so the UI reflects the change
 * without a hard reload.
 */
export function useAttestWaiver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; notes?: string }) =>
      attestWaiverFn({ data: input }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: WAIVER_PENDING_QUEUE_QUERY_KEY,
        }),
        queryClient.invalidateQueries({
          queryKey: waiverHistoryForUserQueryKey(variables.userId),
        }),
        queryClient.invalidateQueries({
          queryKey: MY_WAIVER_STATUS_QUERY_KEY,
        }),
        queryClient.invalidateQueries({
          queryKey: MY_WAIVER_HISTORY_QUERY_KEY,
        }),
      ]);
    },
  });
}

/** Bulk variant — same cache invalidation, broadened to all targets. */
export function useBulkAttestWaivers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userIds: string[]; notes?: string }) =>
      bulkAttestWaiversFn({ data: input }),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: WAIVER_PENDING_QUEUE_QUERY_KEY,
      });
      // Per-target history caches — only invalidate ones we actually
      // attested.
      await Promise.all(
        variables.userIds.map((userId) =>
          queryClient.invalidateQueries({
            queryKey: waiverHistoryForUserQueryKey(userId),
          }),
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: MY_WAIVER_STATUS_QUERY_KEY,
        }),
        queryClient.invalidateQueries({
          queryKey: MY_WAIVER_HISTORY_QUERY_KEY,
        }),
      ]);
    },
  });
}

/**
 * Officer revokes a prior attestation. The caller-supplied `userId` is
 * used only to scope cache invalidation — the server-side action
 * looks up the attestation by `attestationId`.
 */
export function useRevokeWaiverAttestation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      attestationId: string;
      reason: string;
      userId: string;
    }) =>
      revokeWaiverAttestationFn({
        data: { attestationId: input.attestationId, reason: input.reason },
      }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: WAIVER_PENDING_QUEUE_QUERY_KEY,
        }),
        queryClient.invalidateQueries({
          queryKey: waiverHistoryForUserQueryKey(variables.userId),
        }),
        queryClient.invalidateQueries({
          queryKey: MY_WAIVER_STATUS_QUERY_KEY,
        }),
        queryClient.invalidateQueries({
          queryKey: MY_WAIVER_HISTORY_QUERY_KEY,
        }),
      ]);
    },
  });
}
