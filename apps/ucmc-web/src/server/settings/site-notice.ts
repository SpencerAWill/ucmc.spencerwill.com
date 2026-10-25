/**
 * The site notice: a one-line banner at the top of every page, edited on
 * /settings by holders of `notice:manage`.
 *
 * Pure and client-safe — no DB, no `cloudflare:workers` — so the registry,
 * the server read and the banner all share these lists, and Stryker can
 * mutate the module.
 */

/**
 * Preset colours. Each maps to a `--notice-<tone>` / `-foreground` token
 * pair in `styles.css`, and `notice-contrast.test.ts` holds every pair to
 * 4.5:1 in both themes — a free colour picker could not make that promise.
 */
export const NOTICE_TONES = [
  "info",
  "success",
  "warning",
  "danger",
  "neutral",
] as const;
export type NoticeTone = (typeof NOTICE_TONES)[number];

/** Who sees the notice. `members` means approved members only. */
export const NOTICE_AUDIENCES = ["public", "members"] as const;
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];
