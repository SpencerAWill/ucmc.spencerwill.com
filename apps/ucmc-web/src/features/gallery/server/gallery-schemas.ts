/**
 * Zod schemas for /gallery mutation inputs. Shared by the server-fn
 * `inputValidator` (server side) and the typed mutation hooks
 * (client side). The image payload is a base64 dataUrl; size + magic-
 * byte validation lives here as a first defense, with R2 + worker
 * enforcement as defense-in-depth.
 *
 * Only WebP is accepted on the wire — the client crops + transcodes
 * to WebP via `useImageCrop()` before submitting, so any incoming
 * JPEG/PNG would indicate either a non-browser client or a bug.
 */
import { z } from "zod";

export const GALLERY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const GALLERY_IMAGE_DATA_URL_MAX = Math.ceil(
  (GALLERY_IMAGE_MAX_BYTES * 4) / 3 + 100, // base64 overhead + dataUrl prefix
);

const WEBP_DATA_URL_RE = /^data:image\/webp;base64,([A-Za-z0-9+/]+=*)$/;

const photoFields = {
  caption: z.string().trim().max(200).nullable().default(null),
  credit: z.string().trim().max(100).nullable().default(null),
  takenAt: z.coerce.date().nullable().default(null),
  tag: z.string().trim().max(50).nullable().default(null),
  altText: z.string().trim().min(1).max(300),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
} as const;

const imageDataUrl = z
  .string()
  .max(GALLERY_IMAGE_DATA_URL_MAX, {
    message: `Image exceeds the ${GALLERY_IMAGE_MAX_BYTES / (1024 * 1024)} MB cap`,
  })
  .regex(WEBP_DATA_URL_RE, {
    message: "Expected a base64 data URL with image/webp MIME type",
  });

export const createGalleryPhotoInputSchema = z.object({
  ...photoFields,
  imageDataUrl,
});
export type CreateGalleryPhotoInput = z.infer<
  typeof createGalleryPhotoInputSchema
>;

/**
 * Update accepts an optional `imageDataUrl`: omit to keep the existing
 * crop (metadata-only edit), include to swap the file. Action layer
 * deletes the previous R2 object best-effort after a successful swap.
 */
export const updateGalleryPhotoInputSchema = z.object({
  publicId: z.string().min(1),
  ...photoFields,
  imageDataUrl: imageDataUrl.optional(),
});
export type UpdateGalleryPhotoInput = z.infer<
  typeof updateGalleryPhotoInputSchema
>;

export const deleteGalleryPhotoInputSchema = z.object({
  publicId: z.string().min(1),
});
export type DeleteGalleryPhotoInput = z.infer<
  typeof deleteGalleryPhotoInputSchema
>;

export const getGalleryPhotoByPublicIdInputSchema = z.object({
  publicId: z.string().min(1),
});
export type GetGalleryPhotoByPublicIdInput = z.infer<
  typeof getGalleryPhotoByPublicIdInputSchema
>;
