/**
 * Route-facing shells for /volunteer server fns. Each handler body
 * dynamic-imports its action so server-only modules never reach the
 * client bundle; type-only imports of action shapes erase at compile
 * time and are fine.
 */
import { createServerFn } from "@tanstack/react-start";

import type { VolunteerContent } from "#/features/volunteer/server/volunteer-actions.server";
import {
  createEventInputSchema,
  createOpportunityInputSchema,
  deleteByIdInputSchema,
  reorderOpportunitiesInputSchema,
  updateEventInputSchema,
  updateOpportunityInputSchema,
} from "#/features/volunteer/server/volunteer-schemas";

export type {
  VolunteerContent,
  VolunteerEventEntry,
  VolunteerOpportunityEntry,
} from "#/features/volunteer/server/volunteer-actions.server";

// ── read (anonymous-safe; gated by public_volunteer:view at the route
// layer) ────────────────────────────────────────────────────────────────

export const getVolunteerContentFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<VolunteerContent> => {
    const { getVolunteerContentAction } =
      await import("#/features/volunteer/server/volunteer-actions.server");
    return getVolunteerContentAction();
  },
);

// ── programs ────────────────────────────────────────────────────────────

export const createOpportunityFn = createServerFn({ method: "POST" })
  .validator(createOpportunityInputSchema)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { createOpportunityAction } =
      await import("#/features/volunteer/server/volunteer-actions.server");
    return createOpportunityAction(data);
  });

export const updateOpportunityFn = createServerFn({ method: "POST" })
  .validator(updateOpportunityInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateOpportunityAction } =
      await import("#/features/volunteer/server/volunteer-actions.server");
    return updateOpportunityAction(data);
  });

export const deleteOpportunityFn = createServerFn({ method: "POST" })
  .validator(deleteByIdInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteOpportunityAction } =
      await import("#/features/volunteer/server/volunteer-actions.server");
    return deleteOpportunityAction(data);
  });

export const reorderOpportunitiesFn = createServerFn({ method: "POST" })
  .validator(reorderOpportunitiesInputSchema)
  .handler(async ({ data }): Promise<{ ok: true; count: number }> => {
    const { reorderOpportunitiesAction } =
      await import("#/features/volunteer/server/volunteer-actions.server");
    return reorderOpportunitiesAction(data);
  });

// ── outings ─────────────────────────────────────────────────────────────

export const createEventFn = createServerFn({ method: "POST" })
  .validator(createEventInputSchema)
  .handler(async ({ data }): Promise<{ id: string; publicId: string }> => {
    const { createEventAction } =
      await import("#/features/volunteer/server/volunteer-actions.server");
    return createEventAction(data);
  });

export const updateEventFn = createServerFn({ method: "POST" })
  .validator(updateEventInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateEventAction } =
      await import("#/features/volunteer/server/volunteer-actions.server");
    return updateEventAction(data);
  });

export const deleteEventFn = createServerFn({ method: "POST" })
  .validator(deleteByIdInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteEventAction } =
      await import("#/features/volunteer/server/volunteer-actions.server");
    return deleteEventAction(data);
  });
