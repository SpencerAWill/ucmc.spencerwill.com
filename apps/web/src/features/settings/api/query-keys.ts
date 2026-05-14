/**
 * Single TanStack Query key for the /settings admin surface. Every
 * setting hydrates from one snapshot fetch (cheap — a handful of rows)
 * and one mutation invalidates the whole prefix so each form re-reads
 * the canonical value after a write.
 */
export const SITE_SETTINGS_QUERY_KEY = ["site-settings"] as const;

/**
 * Public-read subset key. Distinct from the admin snapshot so a write
 * via `useUpdateSetting` invalidates both — but a public-only read by a
 * signed-out visitor doesn't pull the gated admin snapshot.
 */
export const PUBLIC_SITE_CONTACT_QUERY_KEY = [
  "site-settings",
  "public-contact",
] as const;
