/**
 * Build a browser-facing URL for an R2-stored sponsor logo.
 *
 * Same two emission shapes as the Album's `albumImageUrl()`, picked by
 * whether `VITE_R2_PUBLIC_HOST` is set at build time: the R2 custom
 * domain in deployed envs, and the worker-mediated
 * `/api/sponsor-logo/...` route in local dev / Miniflare.
 *
 * Storage keys are minted by `sponsorLogoKey()` in
 * `#/server/r2/sponsor-logos.server.ts`, which must agree with the
 * prefix below; `logo-url.test.ts` asserts the round trip, because the
 * Album's equivalents drifted apart once and 404'd every photo in local
 * dev.
 */
import { env } from "#/config/env";

/**
 * R2 object-key prefix for sponsor logos.
 *
 * Three places must agree on it: `sponsorLogoKey()` mints keys with it,
 * `sponsorLogoUrl()` strips it for the local-dev URL, and
 * `routes/api/sponsor-logo.$.ts` prepends it back. `GC_PREFIXES` in
 * `#/server/cron/retention.server.ts` also lists it — drop it there and
 * a replaced logo's old object is never swept.
 */
export const SPONSOR_R2_PREFIX = "sponsors/";

export function sponsorLogoUrl(logoKey: string): string {
  const cdnHost = env.VITE_R2_PUBLIC_HOST;
  if (cdnHost) {
    return `https://${cdnHost}/${logoKey}`;
  }
  return `/api/sponsor-logo/${logoKey.slice(SPONSOR_R2_PREFIX.length)}`;
}
