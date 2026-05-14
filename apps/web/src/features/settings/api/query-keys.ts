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

/**
 * Public-read feature-flag snapshot. Distinct from the admin snapshot so
 * the sidebar / bell can read flag state without pulling the gated full
 * settings list. Invalidated alongside the admin snapshot from
 * `useUpdateSetting`.
 */
export const PUBLIC_FLAGS_QUERY_KEY = [
  "site-settings",
  "public-flags",
] as const;

export const settingHistoryQueryKey = (key: string) =>
  ["site-settings", "history", key] as const;
