import { getPublicBucket } from "#/server/r2";

/**
 * Hard upper bound on R2 object size for a sponsor logo. Defense-in-
 * depth behind the zod cap on the source data URL.
 *
 * Far smaller than the Album's 5 MB: a logo is downscaled client-side to
 * fit a 640 px box and is typically 10–60 KB. 1 MB is generous headroom
 * for a detailed mark with an alpha channel while still rejecting an
 * un-resized source that slipped past the client.
 */
export const SPONSOR_LOGO_MAX_BYTES = 1024 * 1024;

/**
 * R2 layout: `sponsors/<id>/<contentHash>.webp`.
 *
 * The `id` segment is the `sponsors.id` row PK, so `r2 object list
 * --prefix sponsors/<id>/` cheaply finds every mark ever uploaded for
 * one sponsor (a replacement writes a new key; the row's `logo_key`
 * points only at the latest). The content-hashed filename is what makes
 * `Cache-Control: immutable` safe forever.
 *
 * Must stay in lockstep with `SPONSOR_R2_PREFIX` in
 * `#/features/sponsors/lib/logo-url.ts`, which strips it back off.
 */
export function sponsorLogoKey(id: string, contentHash: string): string {
  return `sponsors/${id}/${contentHash}.webp`;
}

export async function putSponsorLogo(
  key: string,
  bytes: ArrayBuffer,
): Promise<void> {
  if (bytes.byteLength > SPONSOR_LOGO_MAX_BYTES) {
    throw new Error(
      `Sponsor logo exceeds ${SPONSOR_LOGO_MAX_BYTES} bytes (got ${bytes.byteLength})`,
    );
  }
  await getPublicBucket().put(key, bytes, {
    // Cache-Control is set at upload time because the public bucket is
    // served through an R2 custom domain that bypasses the worker —
    // there is no read path on which to inject a header. Keys are
    // content-hashed, so `immutable` is safe; a replacement upload
    // produces a new key.
    httpMetadata: {
      contentType: "image/webp",
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
}

export async function deleteSponsorLogo(key: string): Promise<void> {
  await getPublicBucket().delete(key);
}
