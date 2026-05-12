/**
 * R2 helpers for per-gear thumbnails. Mirrors
 * `#/features/landing/server/landing-image.server.ts` — content-hashed
 * keys make each upload immutable, so the public-bucket custom-domain
 * read response can carry `Cache-Control: immutable` indefinitely
 * without per-request revalidation.
 *
 * Keys live under `gear/<gearId>/<contentHash>.<ext>`. The per-gear
 * subfolder means two rows that upload identical bytes still get
 * distinct R2 objects — important because edits delete the prior
 * object, and we don't want one gear's "clear thumbnail" to orphan
 * another gear's image. Mirrors the avatar layout.
 */
import {
  decodeImageDataUrl as decodeImageDataUrlShared,
  shortContentHash as shortContentHashShared,
} from "#/server/r2/image-codec.server";
import type { AcceptedImageContentType } from "#/server/r2/image-codec.server";
import { getPublicBucket } from "#/server/r2";

export type GearImageContentType = AcceptedImageContentType;

/**
 * 400 KB upper bound. Gear thumbnails are square ~600px webp; client
 * compression typically lands well under this. Defense-in-depth for
 * non-browser clients trying to skip the compression step.
 */
export const GEAR_THUMBNAIL_MAX_BYTES = 400 * 1024;

export function gearThumbnailKey(
  gearId: string,
  contentHash: string,
  contentType: GearImageContentType,
): string {
  const ext = contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1];
  return `gear/${gearId}/${contentHash}.${ext}`;
}

export async function putGearThumbnail(
  key: string,
  bytes: ArrayBuffer,
  contentType: GearImageContentType,
): Promise<void> {
  if (bytes.byteLength > GEAR_THUMBNAIL_MAX_BYTES) {
    throw new Error(
      `Gear thumbnail exceeds ${GEAR_THUMBNAIL_MAX_BYTES} bytes (got ${bytes.byteLength})`,
    );
  }
  await getPublicBucket().put(key, bytes, {
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
}

export async function getGearThumbnail(
  key: string,
): Promise<R2ObjectBody | null> {
  return getPublicBucket().get(key);
}

export async function deleteGearThumbnail(key: string): Promise<void> {
  await getPublicBucket().delete(key);
}

export function decodeGearThumbnailDataUrl(dataUrl: string) {
  return decodeImageDataUrlShared(dataUrl, GEAR_THUMBNAIL_MAX_BYTES);
}

export async function gearShortContentHash(
  bytes: ArrayBuffer,
): Promise<string> {
  return shortContentHashShared(bytes);
}
