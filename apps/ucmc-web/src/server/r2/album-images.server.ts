import { getPublicBucket } from "#/server/r2";

/**
 * Hard upper bound on R2 object size for Album photos. Defense-in-
 * depth — the zod schema caps the source dataUrl payload before this
 * helper sees the bytes, and the client crops to a 4:3 WebP at 1600
 * × 1200 which is typically 200–500 KB. 5 MB leaves ample headroom
 * for high-quality compressed photos without pushing toward the
 * worker request body limit.
 */
export const ALBUM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * R2 layout: `gallery/<id>/<contentHash>.webp` — the prefix is
 * deliberately still `gallery/` after the feature was renamed to
 * Album. Object keys aren't user-visible, so re-keying would mean a
 * copy-then-delete pass over every deployed bucket for no benefit,
 * and a partial pass strands photos. Must stay in lockstep with
 * `ALBUM_R2_PREFIX` in `#/features/album/lib/image-url.ts`, which
 * strips it back off; `album-image-key.test.ts` asserts the round
 * trip.
 *
 * The `id` segment is the album_photos.id row PK, so `r2 object list
 * --prefix gallery/<id>/` cheaply finds every cropped version
 * associated with one photo (replacement uploads create a new key but
 * the row's imageKey only points at the latest). Content-hashed
 * filename means `Cache-Control: immutable` is safe forever; CDN
 * caches can hold the bytes effectively indefinitely.
 */
export function albumImageKey(id: string, contentHash: string): string {
  return `gallery/${id}/${contentHash}.webp`;
}

export async function putAlbumImage(
  key: string,
  bytes: ArrayBuffer,
): Promise<void> {
  if (bytes.byteLength > ALBUM_IMAGE_MAX_BYTES) {
    throw new Error(
      `Album image exceeds ${ALBUM_IMAGE_MAX_BYTES} bytes (got ${bytes.byteLength})`,
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

export async function deleteAlbumImage(key: string): Promise<void> {
  await getPublicBucket().delete(key);
}
