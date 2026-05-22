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
  updateHistoricalOfficerInputSchema,
  updateHonoraryMemberInputSchema,
  updateNarrativeInputSchema,
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

// ── narrative ───────────────────────────────────────────────────────────

export const updateNarrativeFn = createServerFn({ method: "POST" })
  .inputValidator(updateNarrativeInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateNarrativeAction } =
      await import("#/features/history/server/history-actions.server");
    return updateNarrativeAction(data);
  });

// ── historical officers ─────────────────────────────────────────────────

export const createHistoricalOfficerFn = createServerFn({ method: "POST" })
  .inputValidator(createHistoricalOfficerInputSchema)
  .handler(async ({ data }): Promise<{ id: number }> => {
    const { createHistoricalOfficerAction } =
      await import("#/features/history/server/history-actions.server");
    return createHistoricalOfficerAction(data);
  });

export const updateHistoricalOfficerFn = createServerFn({ method: "POST" })
  .inputValidator(updateHistoricalOfficerInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateHistoricalOfficerAction } =
      await import("#/features/history/server/history-actions.server");
    return updateHistoricalOfficerAction(data);
  });

export const deleteHistoricalOfficerFn = createServerFn({ method: "POST" })
  .inputValidator(deleteByIdInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteHistoricalOfficerAction } =
      await import("#/features/history/server/history-actions.server");
    return deleteHistoricalOfficerAction(data);
  });

// ── honorary members ────────────────────────────────────────────────────

export const createHonoraryMemberFn = createServerFn({ method: "POST" })
  .inputValidator(createHonoraryMemberInputSchema)
  .handler(async ({ data }): Promise<{ id: number }> => {
    const { createHonoraryMemberAction } =
      await import("#/features/history/server/history-actions.server");
    return createHonoraryMemberAction(data);
  });

export const updateHonoraryMemberFn = createServerFn({ method: "POST" })
  .inputValidator(updateHonoraryMemberInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateHonoraryMemberAction } =
      await import("#/features/history/server/history-actions.server");
    return updateHonoraryMemberAction(data);
  });

export const deleteHonoraryMemberFn = createServerFn({ method: "POST" })
  .inputValidator(deleteByIdInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteHonoraryMemberAction } =
      await import("#/features/history/server/history-actions.server");
    return deleteHonoraryMemberAction(data);
  });
