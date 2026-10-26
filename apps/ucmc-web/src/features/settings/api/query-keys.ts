import type { NoticeViewer } from "#/server/settings/site-notice";

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

/**
 * Public-read header-masthead strings. Its own key rather than a couple
 * of extra fields on the contact payload: the contact read is genuinely
 * contact information, consumed by the footer and the landing page, and
 * widening it to carry chrome text would make the name a lie. Every
 * public key shares the `["site-settings"]` prefix, so one
 * `useUpdateSetting` write invalidates all of them.
 */
export const PUBLIC_BRANDING_QUERY_KEY = [
  "site-settings",
  "public-branding",
] as const;

/**
 * The site notice, keyed by viewer. The server answers differently for a
 * signed-out visitor, a pending account and an approved member, so each
 * gets its own cache entry: signing in or out re-keys the banner rather
 * than showing the previous audience's answer. Under the `["site-settings"]`
 * prefix, so a notice edit invalidates every viewer's entry.
 */
export const siteNoticeQueryKey = (viewer: NoticeViewer) =>
  ["site-settings", "notice", viewer] as const;

export const settingHistoryQueryKey = (key: string) =>
  ["site-settings", "history", key] as const;
