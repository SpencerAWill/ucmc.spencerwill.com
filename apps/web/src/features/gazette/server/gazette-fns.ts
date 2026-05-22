/**
 * Route-facing shells for /gazette server fns. Each handler body
 * dynamic-imports its action module so server-only code never reaches
 * the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";

import type { GazetteIssueSummary } from "#/features/gazette/server/gazette-actions.server";
import {
  createGazetteIssueInputSchema,
  deleteGazetteIssueInputSchema,
  getGazetteIssueByPublicIdInputSchema,
  updateGazetteIssueInputSchema,
} from "#/features/gazette/server/gazette-schemas";

export type { GazetteIssueSummary };

// ── reads (gated at the route layer by public_gazette:view) ────────────

export const getGazetteIssuesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ issues: GazetteIssueSummary[] }> => {
    const { getGazetteIssuesAction } =
      await import("#/features/gazette/server/gazette-actions.server");
    return getGazetteIssuesAction();
  },
);

export const getGazetteIssueByPublicIdFn = createServerFn({ method: "GET" })
  .inputValidator(getGazetteIssueByPublicIdInputSchema)
  .handler(async ({ data }): Promise<GazetteIssueSummary | null> => {
    const { getGazetteIssueByPublicIdAction } =
      await import("#/features/gazette/server/gazette-actions.server");
    return getGazetteIssueByPublicIdAction(data);
  });

// ── mutations (gated at the action layer by public_gazette:manage) ─────

export const createGazetteIssueFn = createServerFn({ method: "POST" })
  .inputValidator(createGazetteIssueInputSchema)
  .handler(async ({ data }): Promise<{ publicId: string }> => {
    const { createGazetteIssueAction } =
      await import("#/features/gazette/server/gazette-actions.server");
    return createGazetteIssueAction(data);
  });

export const updateGazetteIssueFn = createServerFn({ method: "POST" })
  .inputValidator(updateGazetteIssueInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateGazetteIssueAction } =
      await import("#/features/gazette/server/gazette-actions.server");
    return updateGazetteIssueAction(data);
  });

export const deleteGazetteIssueFn = createServerFn({ method: "POST" })
  .inputValidator(deleteGazetteIssueInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteGazetteIssueAction } =
      await import("#/features/gazette/server/gazette-actions.server");
    return deleteGazetteIssueAction(data);
  });
