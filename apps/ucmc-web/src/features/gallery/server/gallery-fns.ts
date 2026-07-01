/**
 * Route-facing shells for /gallery server fns. Each handler body
 * dynamic-imports its action module so server-only code never reaches
 * the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";

import type { GalleryPhotoSummary } from "#/features/gallery/server/gallery-actions.server";
import {
  createGalleryPhotoInputSchema,
  deleteGalleryPhotoInputSchema,
  getGalleryPhotoByPublicIdInputSchema,
  updateGalleryPhotoInputSchema,
} from "#/features/gallery/server/gallery-schemas";

export type { GalleryPhotoSummary };

// ── reads (gated at the route layer by public_gallery:view) ────────────

export const getGalleryPhotosFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ photos: GalleryPhotoSummary[] }> => {
    const { getGalleryPhotosAction } =
      await import("#/features/gallery/server/gallery-actions.server");
    return getGalleryPhotosAction();
  },
);

export const getGalleryPhotoByPublicIdFn = createServerFn({ method: "GET" })
  .inputValidator(getGalleryPhotoByPublicIdInputSchema)
  .handler(async ({ data }): Promise<GalleryPhotoSummary | null> => {
    const { getGalleryPhotoByPublicIdAction } =
      await import("#/features/gallery/server/gallery-actions.server");
    return getGalleryPhotoByPublicIdAction(data);
  });

// ── mutations (gated at the action layer by public_gallery:manage) ─────

export const createGalleryPhotoFn = createServerFn({ method: "POST" })
  .inputValidator(createGalleryPhotoInputSchema)
  .handler(async ({ data }): Promise<{ publicId: string }> => {
    const { createGalleryPhotoAction } =
      await import("#/features/gallery/server/gallery-actions.server");
    return createGalleryPhotoAction(data);
  });

export const updateGalleryPhotoFn = createServerFn({ method: "POST" })
  .inputValidator(updateGalleryPhotoInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateGalleryPhotoAction } =
      await import("#/features/gallery/server/gallery-actions.server");
    return updateGalleryPhotoAction(data);
  });

export const deleteGalleryPhotoFn = createServerFn({ method: "POST" })
  .inputValidator(deleteGalleryPhotoInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteGalleryPhotoAction } =
      await import("#/features/gallery/server/gallery-actions.server");
    return deleteGalleryPhotoAction(data);
  });
