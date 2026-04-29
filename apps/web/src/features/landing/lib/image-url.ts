/**
 * Build a public URL for an R2-stored landing image.
 *
 * R2 keys are namespaced under `landing/` (e.g. `landing/hero/<hash>.webp`);
 * the public route at `/api/landing/$` strips that prefix from the URL and
 * re-prepends it server-side, so the URL contains the prefix exactly once
 * (`/api/landing/hero/<hash>.webp`) instead of doubling it.
 */
const LANDING_PREFIX = "landing/";

export function landingImageUrlFor(imageKey: string): string {
  const path = imageKey.startsWith(LANDING_PREFIX)
    ? imageKey.slice(LANDING_PREFIX.length)
    : imageKey;
  return `/api/landing/${path}`;
}
