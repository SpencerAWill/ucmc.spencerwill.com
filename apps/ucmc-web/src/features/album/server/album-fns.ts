/**
 * Route-facing shells for /album server fns. Each handler body
 * dynamic-imports its action module so server-only code never reaches
 * the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";

import type { AlbumPhotoSummary } from "#/features/album/server/album-actions.server";
import {
  createAlbumPhotoInputSchema,
  deleteAlbumPhotoInputSchema,
  getAlbumPhotoByPublicIdInputSchema,
  updateAlbumPhotoInputSchema,
} from "#/features/album/server/album-schemas";

export type { AlbumPhotoSummary };

// ── reads (gated at the route layer by public_album:view) ────────────

export const getAlbumPhotosFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ photos: AlbumPhotoSummary[] }> => {
    const { getAlbumPhotosAction } =
      await import("#/features/album/server/album-actions.server");
    return getAlbumPhotosAction();
  },
);

export const getAlbumPhotoByPublicIdFn = createServerFn({ method: "GET" })
  .validator(getAlbumPhotoByPublicIdInputSchema)
  .handler(async ({ data }): Promise<AlbumPhotoSummary | null> => {
    const { getAlbumPhotoByPublicIdAction } =
      await import("#/features/album/server/album-actions.server");
    return getAlbumPhotoByPublicIdAction(data);
  });

// ── mutations (gated at the action layer by public_album:manage) ─────

export const createAlbumPhotoFn = createServerFn({ method: "POST" })
  .validator(createAlbumPhotoInputSchema)
  .handler(async ({ data }): Promise<{ publicId: string }> => {
    const { createAlbumPhotoAction } =
      await import("#/features/album/server/album-actions.server");
    return createAlbumPhotoAction(data);
  });

export const updateAlbumPhotoFn = createServerFn({ method: "POST" })
  .validator(updateAlbumPhotoInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateAlbumPhotoAction } =
      await import("#/features/album/server/album-actions.server");
    return updateAlbumPhotoAction(data);
  });

export const deleteAlbumPhotoFn = createServerFn({ method: "POST" })
  .validator(deleteAlbumPhotoInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteAlbumPhotoAction } =
      await import("#/features/album/server/album-actions.server");
    return deleteAlbumPhotoAction(data);
  });
