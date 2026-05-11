/**
 * R2 helpers for any landing-page image (hero slides, activity cards,
 * about-section illustration). All keys live under the `landing/` prefix
 * with a per-section subdir (`hero/`, `activities/`, `about/`).
 *
 * Mirrors `#/server/r2/avatars.server.ts` — content-hashed keys make each
 * upload immutable, so the public route can serve `Cache-Control:
 * immutable` without revalidation.
 */
import { getPublicBucket } from "#/server/r2";
import {
  decodeImageDataUrl as decodeImageDataUrlShared,
  shortContentHash as shortContentHashShared,
} from "#/server/r2/image-codec.server";
import type { AcceptedImageContentType } from "#/server/r2/image-codec.server";

import { HERO_IMAGE_MAX_BYTES } from "#/features/landing/server/landing-schemas";

export type LandingImageContentType = AcceptedImageContentType;

/**
 * R2 layout: `landing/<subdir>/<contentHash>.<ext>`. New uploads always
 * produce a new key, so cache busting is automatic on edits.
 */
export function landingImageKey(
  subdir: "hero" | "activities" | "about" | "meeting",
  contentHash: string,
  contentType: LandingImageContentType,
): string {
  const ext = contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1];
  return `landing/${subdir}/${contentHash}.${ext}`;
}

export async function putLandingImage(
  key: string,
  bytes: ArrayBuffer,
  contentType: LandingImageContentType,
): Promise<void> {
  if (bytes.byteLength > HERO_IMAGE_MAX_BYTES) {
    throw new Error(
      `Landing image exceeds ${HERO_IMAGE_MAX_BYTES} bytes (got ${bytes.byteLength})`,
    );
  }
  await getPublicBucket().put(key, bytes, {
    // Cache-Control is set at upload time (not on the read response)
    // because the public bucket is served via a Cloudflare R2 custom
    // domain that bypasses the worker. The custom domain passes through
    // the stored httpMetadata.cacheControl on every GET.
    //
    // Landing keys are content-hashed; new uploads always produce a
    // fresh URL, so `immutable` is safe forever.
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
}

export async function getLandingImage(
  key: string,
): Promise<R2ObjectBody | null> {
  return getPublicBucket().get(key);
}

export async function deleteLandingImage(key: string): Promise<void> {
  await getPublicBucket().delete(key);
}

/**
 * Decode a base64 data URL to raw bytes, validating the declared
 * content type against the actual magic bytes. Delegates to the shared
 * helper in `#/server/r2/image-codec.server`; pinned to the landing
 * size cap so the validation error message matches the form's own
 * limit copy.
 */
export function decodeImageDataUrl(dataUrl: string): {
  contentType: LandingImageContentType;
  bytes: ArrayBuffer;
} {
  return decodeImageDataUrlShared(dataUrl, HERO_IMAGE_MAX_BYTES);
}

export async function shortContentHash(bytes: ArrayBuffer): Promise<string> {
  return shortContentHashShared(bytes);
}
