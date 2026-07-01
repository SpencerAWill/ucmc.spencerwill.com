import { getPublicBucket } from "#/server/r2";

/**
 * Hard upper bound on R2 object size for avatars. The client compresses
 * to ~50 KB; this is defense-in-depth in case a non-browser client
 * tries to skip the compression step. Tuned well below the 1 MiB
 * worker request budget.
 */
export const AVATAR_MAX_BYTES = 200 * 1024;

export type AvatarContentType = "image/webp" | "image/jpeg" | "image/png";

/**
 * R2 layout: `avatars/<userId>/<contentHash>.webp`. The hash makes the
 * key immutable, which means the serving route can use
 * `Cache-Control: immutable` without a per-request DB lookup. One
 * folder per user keeps `r2 object list --prefix` cheap when we want
 * to garbage-collect orphans.
 */
export function avatarKey(
  userId: string,
  contentHash: string,
  contentType: AvatarContentType,
): string {
  const ext = contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1];
  return `avatars/${userId}/${contentHash}.${ext}`;
}

export async function putAvatar(
  key: string,
  bytes: ArrayBuffer,
  contentType: AvatarContentType,
): Promise<void> {
  if (bytes.byteLength > AVATAR_MAX_BYTES) {
    throw new Error(
      `Avatar exceeds ${AVATAR_MAX_BYTES} bytes (got ${bytes.byteLength})`,
    );
  }
  await getPublicBucket().put(key, bytes, {
    // Cache-Control is set at upload time (not on the read response)
    // because the public bucket is served via a Cloudflare R2 custom
    // domain that bypasses the worker — there's no place to inject a
    // header on read. R2 custom domains pass through the object's
    // stored httpMetadata.cacheControl on every GET.
    //
    // Avatar keys are content-hashed, so the URL changes whenever the
    // bytes change; `immutable` is safe forever.
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
}

export async function getAvatar(key: string): Promise<R2ObjectBody | null> {
  return getPublicBucket().get(key);
}

export async function deleteAvatar(key: string): Promise<void> {
  await getPublicBucket().delete(key);
}
