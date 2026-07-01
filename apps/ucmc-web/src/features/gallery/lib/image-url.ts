/**
 * Build a browser-facing URL for an R2-stored Trip Gallery photo.
 *
 * Two emission shapes, picked by whether `VITE_R2_PUBLIC_HOST` is set
 * at build time:
 *   - With CDN host (deployed envs):
 *       https://${VITE_R2_PUBLIC_HOST}/gallery/<id>/<hash>.webp
 *     Bytes are served straight from the Cloudflare R2 custom domain;
 *     the worker is never invoked.
 *   - Without CDN host (local dev / Miniflare):
 *       /api/gallery-image/<id>/<hash>.webp
 *     Falls back to the worker-mediated route in
 *     `apps/ucmc-web/src/routes/api/gallery-image.$.ts`. The route's splat
 *     is interpreted relative to the `gallery/` prefix, so we strip
 *     it here and the route re-prepends server-side.
 *
 * Storage keys are emitted by `galleryImageKey()` in
 * `apps/ucmc-web/src/server/r2/gallery-images.server.ts` and always start
 * with `gallery/`.
 */
import { env } from "#/config/env";

const GALLERY_PREFIX = "gallery/";

export function galleryImageUrl(imageKey: string): string {
  const cdnHost = env.VITE_R2_PUBLIC_HOST;
  if (cdnHost) {
    return `https://${cdnHost}/${imageKey}`;
  }
  return `/api/gallery-image/${imageKey.slice(GALLERY_PREFIX.length)}`;
}
