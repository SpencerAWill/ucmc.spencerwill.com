/**
 * Route-facing shells for feedback server fns. Each handler dynamic-
 * imports its action from `./site-feedback-actions.server` so server-only
 * code never reaches the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";

import type {
  SiteFeedbackOverview,
  SiteFeedbackSummary,
} from "#/features/site-feedback/server/site-feedback-actions.server";
import { siteFeedbackInputSchema } from "#/features/site-feedback/server/limits";

export type { SiteFeedbackOverview, SiteFeedbackSummary };

export const getSiteFeedbackOverviewFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<SiteFeedbackOverview> => {
  const { getSiteFeedbackOverviewAction } =
    await import("#/features/site-feedback/server/site-feedback-actions.server");
  return getSiteFeedbackOverviewAction();
});

export const listMySiteFeedbackFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteFeedbackSummary[]> => {
    const { listMySiteFeedbackAction } =
      await import("#/features/site-feedback/server/site-feedback-actions.server");
    return listMySiteFeedbackAction();
  },
);

export const submitSiteFeedbackFn = createServerFn({ method: "POST" })
  .validator(siteFeedbackInputSchema)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { submitSiteFeedbackAction } =
      await import("#/features/site-feedback/server/site-feedback-actions.server");
    return submitSiteFeedbackAction(data);
  });
