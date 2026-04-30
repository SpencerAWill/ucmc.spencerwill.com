/**
 * Route-facing shells for the paper-waiver attestation server fns. Each
 * handler dynamic-imports its action from `./waiver-actions.server` so
 * server-only code never reaches the client bundle. See `waiver-actions
 * .server.ts` for the action bodies and the rationale for the paper-
 * attestation model (Bylaw 1.3 keeps medical PII off the platform).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type {
  MemberNeedingAttestation,
  WaiverAttestationSummary,
  WaiverStatus,
} from "#/features/auth/server/waiver-actions.server";

export type {
  MemberNeedingAttestation,
  WaiverAttestationSummary,
  WaiverStatus,
};

// Member-facing reads.

export const getMyCurrentWaiverStatusFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<WaiverStatus> => {
  const { getMyCurrentWaiverStatusAction } =
    await import("#/features/auth/server/waiver-actions.server");
  return getMyCurrentWaiverStatusAction();
});

export const listMyWaiverHistoryFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<WaiverAttestationSummary[]> => {
    const { listMyWaiverHistoryAction } =
      await import("#/features/auth/server/waiver-actions.server");
    return listMyWaiverHistoryAction();
  },
);

// Officer-only reads.

export const listMembersNeedingAttestationFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<MemberNeedingAttestation[]> => {
  const { listMembersNeedingAttestationAction } =
    await import("#/features/auth/server/waiver-actions.server");
  return listMembersNeedingAttestationAction();
});

export const listWaiverHistoryForUserFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }): Promise<WaiverAttestationSummary[]> => {
    const { listWaiverHistoryForUserAction } =
      await import("#/features/auth/server/waiver-actions.server");
    return listWaiverHistoryForUserAction(data);
  });

// Officer-only writes.

const NOTES_MAX = 500;

export const attestWaiverFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      userId: z.string().min(1),
      notes: z.string().max(NOTES_MAX).optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { attestWaiverAction } =
      await import("#/features/auth/server/waiver-actions.server");
    return attestWaiverAction(data);
  });

export const bulkAttestWaiversFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      userIds: z.array(z.string().min(1)).min(1).max(200),
      notes: z.string().max(NOTES_MAX).optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ count: number }> => {
    const { bulkAttestWaiversAction } =
      await import("#/features/auth/server/waiver-actions.server");
    return bulkAttestWaiversAction(data);
  });

export const revokeWaiverAttestationFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      attestationId: z.string().min(1),
      reason: z.string().min(1).max(NOTES_MAX),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { revokeWaiverAttestationAction } =
      await import("#/features/auth/server/waiver-actions.server");
    return revokeWaiverAttestationAction(data);
  });
