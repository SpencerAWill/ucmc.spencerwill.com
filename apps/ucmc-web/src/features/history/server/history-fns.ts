/**
 * Route-facing shells for /history server fns. Each handler body
 * dynamic-imports the action so server-only modules never reach the
 * client bundle. Type-only imports of action shapes are fine — they
 * erase at compile time.
 */
import { createServerFn } from "@tanstack/react-start";

import type { HistoryContent } from "#/features/history/server/history-actions.server";
import {
  createHistoricalOfficerInputSchema,
  createHonoraryMemberInputSchema,
  deleteByIdInputSchema,
  deleteOfficersByYearInputSchema,
  reorderHonoraryMembersInputSchema,
  updateHistoricalOfficerInputSchema,
  updateHonoraryMemberInputSchema,
} from "#/features/history/server/history-schemas";

export type {
  HistoryContent,
  HonoraryEntry,
  OfficerEntry,
  OfficerYearGroup,
} from "#/features/history/server/history-actions.server";

// ── read (anonymous-safe at the action layer; gated by history:view
// at the route layer) ────────────────────────────────────────────────

export const getHistoryContentFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<HistoryContent> => {
    const { getHistoryContentAction } =
      await import("#/features/history/server/history-actions.server");
    return getHistoryContentAction();
  },
);

// Narrative editing moved to the generic markdown_pages server fns;
// see #/server/markdown-pages/markdown-pages-fns.ts (slug="history.narrative").

// ── historical officers ─────────────────────────────────────────────────

export const createHistoricalOfficerFn = createServerFn({ method: "POST" })
  .validator(createHistoricalOfficerInputSchema)
  .handler(async ({ data }): Promise<{ id: number }> => {
    const { createHistoricalOfficerAction } =
      await import("#/features/history/server/history-actions.server");
    return createHistoricalOfficerAction(data);
  });

export const updateHistoricalOfficerFn = createServerFn({ method: "POST" })
  .validator(updateHistoricalOfficerInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateHistoricalOfficerAction } =
      await import("#/features/history/server/history-actions.server");
    return updateHistoricalOfficerAction(data);
  });

export const deleteHistoricalOfficerFn = createServerFn({ method: "POST" })
  .validator(deleteByIdInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteHistoricalOfficerAction } =
      await import("#/features/history/server/history-actions.server");
    return deleteHistoricalOfficerAction(data);
  });

export const deleteHistoricalOfficersByYearFn = createServerFn({
  method: "POST",
})
  .validator(deleteOfficersByYearInputSchema)
  .handler(
    async ({
      data,
    }): Promise<{ deletedCount: number; schoolYear: string | null }> => {
      const { deleteHistoricalOfficersByYearAction } =
        await import("#/features/history/server/history-actions.server");
      return deleteHistoricalOfficersByYearAction(data);
    },
  );

// ── honorary members ────────────────────────────────────────────────────

export const createHonoraryMemberFn = createServerFn({ method: "POST" })
  .validator(createHonoraryMemberInputSchema)
  .handler(async ({ data }): Promise<{ id: number }> => {
    const { createHonoraryMemberAction } =
      await import("#/features/history/server/history-actions.server");
    return createHonoraryMemberAction(data);
  });

export const updateHonoraryMemberFn = createServerFn({ method: "POST" })
  .validator(updateHonoraryMemberInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateHonoraryMemberAction } =
      await import("#/features/history/server/history-actions.server");
    return updateHonoraryMemberAction(data);
  });

export const deleteHonoraryMemberFn = createServerFn({ method: "POST" })
  .validator(deleteByIdInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteHonoraryMemberAction } =
      await import("#/features/history/server/history-actions.server");
    return deleteHonoraryMemberAction(data);
  });

export const reorderHonoraryMembersFn = createServerFn({ method: "POST" })
  .validator(reorderHonoraryMembersInputSchema)
  .handler(async ({ data }): Promise<{ ok: true; count: number }> => {
    const { reorderHonoraryMembersAction } =
      await import("#/features/history/server/history-actions.server");
    return reorderHonoraryMembersAction(data);
  });
