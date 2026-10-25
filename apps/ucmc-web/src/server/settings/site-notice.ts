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

/** What a viewer is shown: the trimmed text and its tone. */
export type SiteNotice = { text: string; tone: NoticeTone };

/**
 * The three kinds of viewer the audience policy distinguishes. Every
 * signed-in status other than `approved` — pending, rejected, deactivated —
 * is `pending`: signed in, but not a member.
 */
export type NoticeViewer = "anonymous" | "pending" | "approved";

export function noticeViewerOf(
  principal: { status: string } | null,
): NoticeViewer {
  if (principal === null) {
    return "anonymous";
  }
  return principal.status === "approved" ? "approved" : "pending";
}

/**
 * The notice `viewer` should see, or `null` for none: off, blank (or only
 * whitespace — an empty coloured bar is worse than no bar), or a
 * members-only notice for someone who isn't an approved member.
 */
export function resolveSiteNotice(
  settings: {
    enabled: boolean;
    text: string;
    audience: NoticeAudience;
    tone: NoticeTone;
  },
  viewer: NoticeViewer,
): SiteNotice | null {
  const text = settings.text.trim();
  if (!settings.enabled || text.length === 0) {
    return null;
  }
  if (settings.audience === "members" && viewer !== "approved") {
    return null;
  }
  return { text, tone: settings.tone };
}
