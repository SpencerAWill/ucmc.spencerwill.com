/**
 * Route-facing shells for site-feedback triage. Each handler dynamic-imports
 * its action from `./site-feedback-triage-actions.server` so server-only
 * code never reaches the client bundle. Reads are GET, writes are POST.
 */
import { createServerFn } from "@tanstack/react-start";

import type {
  GithubActionResult,
  SiteFeedbackIssueDetail,
  SiteFeedbackIssueSummary,
  SiteFeedbackTriage,
  SiteFeedbackTriageRow,
  SyncSiteFeedbackIssuesResult,
} from "#/features/site-feedback/server/site-feedback-triage-actions.server";
import {
  siteFeedbackAttachSchema,
  siteFeedbackDispositionSchema,
  siteFeedbackIssueDraftCreateSchema,
  siteFeedbackIssueDraftUpdateSchema,
  siteFeedbackIssueIdSchema,
  siteFeedbackLinkSchema,
  siteFeedbackPostPendingSchema,
  siteFeedbackQuoteUpdateSchema,
  siteFeedbackRelatedSchema,
  siteFeedbackTriageListSchema,
  siteFeedbackUnlinkSchema,
} from "#/features/site-feedback/server/limits";

export type {
  GithubActionResult,
  SiteFeedbackIssueDetail,
  SiteFeedbackIssueSummary,
  SiteFeedbackTriage,
  SiteFeedbackTriageRow,
};

export const listSiteFeedbackTriageFn = createServerFn({ method: "GET" })
  .validator(siteFeedbackTriageListSchema)
  .handler(async ({ data }): Promise<SiteFeedbackTriage> => {
    const { listSiteFeedbackTriageAction } =
      await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
    return listSiteFeedbackTriageAction(data);
  });

export const getSiteFeedbackIssueFn = createServerFn({ method: "GET" })
  .validator(siteFeedbackIssueIdSchema)
  .handler(async ({ data }): Promise<SiteFeedbackIssueDetail> => {
    const { getSiteFeedbackIssueAction } =
      await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
    return getSiteFeedbackIssueAction(data);
  });

export const listRelatedSiteFeedbackFn = createServerFn({ method: "GET" })
  .validator(siteFeedbackRelatedSchema)
  .handler(async ({ data }): Promise<SiteFeedbackTriageRow[]> => {
    const { listRelatedSiteFeedbackAction } =
      await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
    return listRelatedSiteFeedbackAction(data);
  });

export const setSiteFeedbackDispositionFn = createServerFn({ method: "POST" })
  .validator(siteFeedbackDispositionSchema)
  .handler(async ({ data }): Promise<{ updated: number }> => {
    const { setSiteFeedbackDispositionAction } =
      await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
    return setSiteFeedbackDispositionAction(data);
  });

export const createSiteFeedbackIssueDraftFn = createServerFn({ method: "POST" })
  .validator(siteFeedbackIssueDraftCreateSchema)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { createSiteFeedbackIssueDraftAction } =
      await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
    return createSiteFeedbackIssueDraftAction(data);
  });

export const updateSiteFeedbackIssueDraftFn = createServerFn({ method: "POST" })
  .validator(siteFeedbackIssueDraftUpdateSchema)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; updatedAtMs: number }
      | { ok: false; reason: "conflict" | "not_draft" }
    > => {
      const { updateSiteFeedbackIssueDraftAction } =
        await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
      return updateSiteFeedbackIssueDraftAction(data);
    },
  );

export const deleteSiteFeedbackIssueDraftFn = createServerFn({ method: "POST" })
  .validator(siteFeedbackIssueIdSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteSiteFeedbackIssueDraftAction } =
      await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
    return deleteSiteFeedbackIssueDraftAction(data);
  });

export const linkSiteFeedbackFn = createServerFn({ method: "POST" })
  .validator(siteFeedbackLinkSchema)
  .handler(async ({ data }): Promise<{ added: number }> => {
    const { linkSiteFeedbackAction } =
      await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
    return linkSiteFeedbackAction(data);
  });

export const unlinkSiteFeedbackFn = createServerFn({ method: "POST" })
  .validator(siteFeedbackUnlinkSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { unlinkSiteFeedbackAction } =
      await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
    return unlinkSiteFeedbackAction(data);
  });

export const updateSiteFeedbackQuoteFn = createServerFn({ method: "POST" })
  .validator(siteFeedbackQuoteUpdateSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateSiteFeedbackQuoteAction } =
      await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
    return updateSiteFeedbackQuoteAction(data);
  });

export const fileSiteFeedbackIssueFn = createServerFn({ method: "POST" })
  .validator(siteFeedbackIssueIdSchema)
  .handler(
    async ({
      data,
    }): Promise<GithubActionResult<{ number: number; url: string }>> => {
      const { fileSiteFeedbackIssueAction } =
        await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
      return fileSiteFeedbackIssueAction(data);
    },
  );

export const attachSiteFeedbackToGithubIssueFn = createServerFn({
  method: "POST",
})
  .validator(siteFeedbackAttachSchema)
  .handler(
    async ({ data }): Promise<GithubActionResult<{ issueId: string }>> => {
      const { attachSiteFeedbackToGithubIssueAction } =
        await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
      return attachSiteFeedbackToGithubIssueAction(data);
    },
  );

export const postPendingSiteFeedbackReportsFn = createServerFn({
  method: "POST",
})
  .validator(siteFeedbackPostPendingSchema)
  .handler(
    async ({ data }): Promise<GithubActionResult<{ posted: number }>> => {
      const { postPendingSiteFeedbackReportsAction } =
        await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
      return postPendingSiteFeedbackReportsAction(data);
    },
  );

export const syncSiteFeedbackIssuesFn = createServerFn({
  method: "POST",
}).handler(async (): Promise<SyncSiteFeedbackIssuesResult> => {
  const { syncSiteFeedbackIssuesAction } =
    await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
  return syncSiteFeedbackIssuesAction();
});
