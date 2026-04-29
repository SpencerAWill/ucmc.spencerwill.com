/**
 * R2 helpers for any landing-page image (hero slides, activity cards,
 * about-section illustration). All keys live under the `landing/` prefix
 * with a per-section subdir (`hero/`, `activities/`, `about/`).
 *
 * Mirrors `#/server/r2/avatars.server.ts` — content-hashed keys make each
 * upload immutable, so the public route can serve `Cache-Control:
 * immutable` without revalidation.
 */
import { getBucket } from "#/server/r2";

import { HERO_IMAGE_MAX_BYTES } from "#/features/landing/server/landing-schemas";

export type LandingImageContentType = "image/webp" | "image/jpeg" | "image/png";

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
  await getBucket().put(key, bytes, {
    httpMetadata: { contentType },
  });
}

export async function getLandingImage(
  key: string,
): Promise<R2ObjectBody | null> {
  return getBucket().get(key);
}

export async function deleteLandingImage(key: string): Promise<void> {
  await getBucket().delete(key);
}

const DATA_URL_RE =
  /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+=*)$/;

/**
 * Decode a base64 data URL to raw bytes, validating the declared content
 * type against the actual magic bytes. An attacker who skips the client
 * could lie in the prefix, so verify the actual bytes too.
 */
export function decodeImageDataUrl(dataUrl: string): {
  contentType: LandingImageContentType;
  bytes: ArrayBuffer;
} {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) {
    throw new Error("Image data URL is not a recognized type");
  }
  const contentType = match[1] as LandingImageContentType;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (bytes.byteLength > HERO_IMAGE_MAX_BYTES) {
    throw new Error(
      `Image exceeds ${HERO_IMAGE_MAX_BYTES} bytes (got ${bytes.byteLength})`,
    );
  }
  if (!matchesMagic(bytes, contentType)) {
    throw new Error("Image bytes do not match declared content type");
  }
  return { contentType, bytes: bytes.buffer };
}

function matchesMagic(bytes: Uint8Array, contentType: LandingImageContentType) {
  if (contentType === "image/webp") {
    return (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  if (contentType === "image/jpeg") {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export async function shortContentHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
