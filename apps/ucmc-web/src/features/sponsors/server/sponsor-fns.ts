/**
 * Route-facing shells for /sponsors server fns. Each handler body
 * dynamic-imports its action so server-only modules never reach the
 * client bundle; type-only imports of action shapes erase at compile
 * time and are fine.
 */
import { createServerFn } from "@tanstack/react-start";

import type { SponsorsContent } from "#/features/sponsors/server/sponsor-actions.server";
import {
  createSponsorInputSchema,
  deleteSponsorInputSchema,
  reorderSponsorsInputSchema,
  updateSponsorInputSchema,
} from "#/features/sponsors/server/sponsor-schemas";

export type {
  SponsorEntry,
  SponsorsContent,
} from "#/features/sponsors/server/sponsor-actions.server";

// ── read (anonymous-safe; gated by public_sponsors:view at the route
// layer, and projected per-viewer for the member-only perk column) ──────

export const getSponsorsContentFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SponsorsContent> => {
    const { getSponsorsContentAction } =
      await import("#/features/sponsors/server/sponsor-actions.server");
    return getSponsorsContentAction();
  },
);

// ── writes (public_sponsors:manage) ─────────────────────────────────────

export const createSponsorFn = createServerFn({ method: "POST" })
  .validator(createSponsorInputSchema)
  .handler(async ({ data }): Promise<{ id: string; publicId: string }> => {
    const { createSponsorAction } =
      await import("#/features/sponsors/server/sponsor-actions.server");
    return createSponsorAction(data);
  });

export const updateSponsorFn = createServerFn({ method: "POST" })
  .validator(updateSponsorInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateSponsorAction } =
      await import("#/features/sponsors/server/sponsor-actions.server");
    return updateSponsorAction(data);
  });

export const deleteSponsorFn = createServerFn({ method: "POST" })
  .validator(deleteSponsorInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteSponsorAction } =
      await import("#/features/sponsors/server/sponsor-actions.server");
    return deleteSponsorAction(data);
  });

export const reorderSponsorsFn = createServerFn({ method: "POST" })
  .validator(reorderSponsorsInputSchema)
  .handler(async ({ data }): Promise<{ ok: true; count: number }> => {
    const { reorderSponsorsAction } =
      await import("#/features/sponsors/server/sponsor-actions.server");
    return reorderSponsorsAction(data);
  });
