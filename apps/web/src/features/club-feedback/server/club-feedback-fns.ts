/**
 * Route-facing shells for club-feedback server fns. Each handler dynamic-
 * imports its action from `./club-feedback-actions.server` so server-only
 * code never reaches the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";

import type { ClubFeedbackSummary } from "#/features/club-feedback/server/club-feedback-actions.server";
import {
  clubFeedbackInputSchema,
  clubFeedbackStatusUpdateSchema,
} from "#/features/club-feedback/server/limits";

export type { ClubFeedbackSummary };

export const listMyClubFeedbackFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<ClubFeedbackSummary[]> => {
    const { listMyClubFeedbackAction } =
      await import("#/features/club-feedback/server/club-feedback-actions.server");
    return listMyClubFeedbackAction();
  },
);

export const listAllClubFeedbackFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<ClubFeedbackSummary[]> => {
    const { listAllClubFeedbackAction } =
      await import("#/features/club-feedback/server/club-feedback-actions.server");
    return listAllClubFeedbackAction();
  },
);

export const submitClubFeedbackFn = createServerFn({ method: "POST" })
  .inputValidator(clubFeedbackInputSchema)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { submitClubFeedbackAction } =
      await import("#/features/club-feedback/server/club-feedback-actions.server");
    return submitClubFeedbackAction(data);
  });

export const updateClubFeedbackStatusFn = createServerFn({ method: "POST" })
  .inputValidator(clubFeedbackStatusUpdateSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateClubFeedbackStatusAction } =
      await import("#/features/club-feedback/server/club-feedback-actions.server");
    return updateClubFeedbackStatusAction(data);
  });
