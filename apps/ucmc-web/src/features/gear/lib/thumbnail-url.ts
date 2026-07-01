/**
 * Build a browser-facing URL for a gear thumbnail stored under the
 * `gear/` R2 prefix.
 *
 * Two emission shapes, picked by whether `VITE_R2_PUBLIC_HOST` is set
 * at build time:
 *   - With CDN host (deployed envs): `https://${cdnHost}/gear/<hash>.<ext>`
 *     served straight from the R2 custom domain; worker bypassed.
 *   - Without CDN host (local dev): `/api/gear-thumbnails/<hash>.<ext>`
 *     served by the route at `apps/ucmc-web/src/routes/api/gear-thumbnails.$.ts`.
 *
 * Mirrors the landing image URL helper.
 */
import { env } from "#/config/env";

const GEAR_PREFIX = "gear/";

export function gearThumbnailUrlFor(thumbnailKey: string): string {
  const cdnHost = env.VITE_R2_PUBLIC_HOST;
  if (cdnHost) {
    return `https://${cdnHost}/${thumbnailKey}`;
  }
  return `/api/gear-thumbnails/${thumbnailKey.slice(GEAR_PREFIX.length)}`;
}
