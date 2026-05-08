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
 *     `apps/web/src/routes/api/landing.$.ts`. The route's splat is
 *     interpreted relative to the `landing/` prefix, so we strip it
 *     here and the route re-prepends server-side.
 *
 * Storage keys are emitted by `landingImageKey()` in
 * `apps/web/src/features/landing/server/landing-image.server.ts` and
 * always start with `landing/`.
 */
import { env } from "#/config/env";

const LANDING_PREFIX = "landing/";

export function landingImageUrlFor(imageKey: string): string {
  const cdnHost = env.VITE_R2_PUBLIC_HOST;
  if (cdnHost) {
    return `https://${cdnHost}/${imageKey}`;
  }
  return `/api/landing/${imageKey.slice(LANDING_PREFIX.length)}`;
}
