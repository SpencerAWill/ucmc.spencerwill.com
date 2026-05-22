import { getPublicBucket } from "#/server/r2";

/**
 * Hard upper bound on R2 object size for Gallery photos. Defense-in-
 * depth — the zod schema caps the source dataUrl payload before this
 * helper sees the bytes, and the client crops to a 4:3 WebP at 1600
 * × 1200 which is typically 200–500 KB. 5 MB leaves ample headroom
 * for high-quality compressed photos without pushing toward the
 * worker request body limit.
 */
export const GALLERY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * R2 layout: `gallery/<id>/<contentHash>.webp`. The `id` segment is
 * the gallery_photos.id row PK, so `r2 object list --prefix
 * gallery/<id>/` cheaply finds every cropped version associated
 * with one photo (replacement uploads create a new key but the row's
 * imageKey only points at the latest). Content-hashed filename
 * means `Cache-Control: immutable` is safe forever; CDN caches can
 * hold the bytes effectively indefinitely.
 */
export function galleryImageKey(id: string, contentHash: string): string {
  return `gallery/${id}/${contentHash}.webp`;
}

export async function putGalleryImage(
  key: string,
  bytes: ArrayBuffer,
): Promise<void> {
  if (bytes.byteLength > GALLERY_IMAGE_MAX_BYTES) {
    throw new Error(
      `Gallery image exceeds ${GALLERY_IMAGE_MAX_BYTES} bytes (got ${bytes.byteLength})`,
    );
  }
  await getPublicBucket().put(key, bytes, {
    // Cache-Control is set at upload time because the public bucket
    // is served via a Cloudflare R2 custom domain that bypasses the
    // worker — there's no place to inject a header on read. Keys
    // are content-hashed, so `immutable` is safe forever; a
    // replacement upload produces a new key.
    httpMetadata: {
      contentType: "image/webp",
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
}

export async function deleteGalleryImage(key: string): Promise<void> {
  await getPublicBucket().delete(key);
}
