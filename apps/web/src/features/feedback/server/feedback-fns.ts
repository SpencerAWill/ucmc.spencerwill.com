/**
 * Route-facing shells for feedback server fns. Each handler dynamic-
 * imports its action from `./feedback-actions.server` so server-only
 * code never reaches the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";

import type { FeedbackSummary } from "#/features/feedback/server/feedback-actions.server";
import {
  feedbackInputSchema,
  feedbackStatusUpdateSchema,
} from "#/features/feedback/server/limits";

export type { FeedbackSummary };

export const listMyFeedbackFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<FeedbackSummary[]> => {
    const { listMyFeedbackAction } =
      await import("#/features/feedback/server/feedback-actions.server");
    return listMyFeedbackAction();
  },
);

export const listAllFeedbackFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<FeedbackSummary[]> => {
    const { listAllFeedbackAction } =
      await import("#/features/feedback/server/feedback-actions.server");
    return listAllFeedbackAction();
  },
);

export const submitFeedbackFn = createServerFn({ method: "POST" })
  .inputValidator(feedbackInputSchema)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { submitFeedbackAction } =
      await import("#/features/feedback/server/feedback-actions.server");
    return submitFeedbackAction(data);
  });

export const updateFeedbackStatusFn = createServerFn({ method: "POST" })
  .inputValidator(feedbackStatusUpdateSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateFeedbackStatusAction } =
      await import("#/features/feedback/server/feedback-actions.server");
    return updateFeedbackStatusAction(data);
  });
