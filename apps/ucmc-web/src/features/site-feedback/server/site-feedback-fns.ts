/**
 * Route-facing shells for feedback server fns. Each handler dynamic-
 * imports its action from `./site-feedback-actions.server` so server-only
 * code never reaches the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";

import type { SiteFeedbackSummary } from "#/features/site-feedback/server/site-feedback-actions.server";
import {
  siteFeedbackInputSchema,
  siteFeedbackStatusUpdateSchema,
} from "#/features/site-feedback/server/limits";

export type { SiteFeedbackSummary };

export const listMySiteFeedbackFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteFeedbackSummary[]> => {
    const { listMySiteFeedbackAction } =
      await import("#/features/site-feedback/server/site-feedback-actions.server");
    return listMySiteFeedbackAction();
  },
);

export const listAllSiteFeedbackFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteFeedbackSummary[]> => {
    const { listAllSiteFeedbackAction } =
      await import("#/features/site-feedback/server/site-feedback-actions.server");
    return listAllSiteFeedbackAction();
  },
);

export const submitSiteFeedbackFn = createServerFn({ method: "POST" })
  .validator(siteFeedbackInputSchema)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { submitSiteFeedbackAction } =
      await import("#/features/site-feedback/server/site-feedback-actions.server");
    return submitSiteFeedbackAction(data);
  });

export const updateSiteFeedbackStatusFn = createServerFn({ method: "POST" })
  .validator(siteFeedbackStatusUpdateSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateSiteFeedbackStatusAction } =
      await import("#/features/site-feedback/server/site-feedback-actions.server");
    return updateSiteFeedbackStatusAction(data);
  });
