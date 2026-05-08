/**
 * Build a browser-facing URL for an R2-stored landing image.
 *
 * Two emission shapes, picked by whether `VITE_R2_PUBLIC_HOST` is set
 * at build time:
 *   - With CDN host (deployed envs):
 *       https://${VITE_R2_PUBLIC_HOST}/landing/hero/<hash>.webp
 *     Bytes are served straight from the Cloudflare R2 custom domain;
 *     the worker is never invoked.
 *   - Without CDN host (local dev / Miniflare):
 *       /api/landing/hero/<hash>.webp
 *     Falls back to the worker-mediated route at
 *     `apps/web/src/routes/api/landing.$.ts`.
 *
 * Storage keys live under the `landing/` prefix (e.g.
 * `landing/hero/<hash>.webp`). The CDN URL keeps the full key, while
 * the legacy /api/landing/* route strips it and re-prepends it
 * server-side; both shapes resolve to the same R2 object.
 */
import { env } from "#/config/env";

const LANDING_PREFIX = "landing/";

export function landingImageUrlFor(imageKey: string): string {
  const cdnHost = env.VITE_R2_PUBLIC_HOST;
  if (cdnHost) {
    const key = imageKey.startsWith(LANDING_PREFIX)
      ? imageKey
      : `${LANDING_PREFIX}${imageKey}`;
    return `https://${cdnHost}/${key}`;
  }
  const path = imageKey.startsWith(LANDING_PREFIX)
    ? imageKey.slice(LANDING_PREFIX.length)
    : imageKey;
  return `/api/landing/${path}`;
}
