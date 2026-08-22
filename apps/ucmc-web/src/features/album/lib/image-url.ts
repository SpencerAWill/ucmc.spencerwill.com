/**
 * Build a browser-facing URL for an R2-stored Album photo.
 *
 * Two emission shapes, picked by whether `VITE_R2_PUBLIC_HOST` is set
 * at build time:
 *   - With CDN host (deployed envs):
 *       https://${VITE_R2_PUBLIC_HOST}/gallery/<id>/<hash>.webp
 *     Bytes are served straight from the Cloudflare R2 custom domain;
 *     the worker is never invoked.
 *   - Without CDN host (local dev / Miniflare):
 *       /api/album-image/<id>/<hash>.webp
 *     Falls back to the worker-mediated route in
 *     `apps/ucmc-web/src/routes/api/album-image.$.ts`. The route's splat
 *     is interpreted relative to the R2 prefix, so we strip it here
 *     and the route re-prepends it server-side.
 *
 * Storage keys are emitted by `albumImageKey()` in
 * `apps/ucmc-web/src/server/r2/album-images.server.ts`.
 */
import { env } from "#/config/env";

/**
 * R2 object-key prefix for album photos. Still `gallery/` after the
 * feature was renamed from "Trip Gallery" to "Album": object keys are
 * never user-visible (the CDN URL is the only thing anyone sees, and it
 * carries whatever prefix the key has), so re-keying would mean a
 * copy-then-delete pass over every deployed bucket to buy nothing. A
 * half-finished pass would strand photos, which is a worse outcome than
 * a historical prefix.
 *
 * Exported so the local-dev serving route strips and re-prepends the
 * same string — they drifted apart once already during the rename.
 * `albumImageKey()` in `#/server/r2/album-images.server.ts` mints keys
 * with this prefix and must agree; `album-image-key.test.ts` asserts
 * the round trip.
 */
export const ALBUM_R2_PREFIX = "gallery/";

export function albumImageUrl(imageKey: string): string {
  const cdnHost = env.VITE_R2_PUBLIC_HOST;
  if (cdnHost) {
    return `https://${cdnHost}/${imageKey}`;
  }
  return `/api/album-image/${imageKey.slice(ALBUM_R2_PREFIX.length)}`;
}
