/**
 * Single source-of-truth for every notification a member can receive.
 *
 * The per-user mirror of `settings-registry.ts`: each entry pairs a
 * category key with the metadata that drives both the preferences UI and
 * the senders. **Adding a category is an entry here, not a migration** —
 * `user_notification_preferences` stores a sparse row only when a member
 * moves a category off its default.
 *
 * Lives in `src/server/` rather than a feature because the gear reminder
 * cron, the preferences tab and (eventually) other senders all need it,
 * and features can't import each other. Same reasoning as
 * `gear-cave-standing.server.ts`.
 *
 * Client-safe: no DB imports. Pure data, so the preferences tab can
 * render straight from it without a second copy of every label.
 */

import type { NotificationChannel } from "../../../drizzle/schema";

// Re-exported so senders and the preferences UI name the channel through
// the registry rather than reaching into the schema for a type.
export type { NotificationChannel };

export interface NotificationCategoryMeta {
  /** Section heading on `/my/preferences`. */
  label: string;
  /** One line under the label, in the member's words, not the club's. */
  description: string;
  /** What a member gets without ever touching the preferences tab. */
  defaultEnabled: boolean;
  /**
   * Whether a member may switch this off at all.
   *
   * **This is where transactional-vs-courtesy lives**, deliberately as a
   * field rather than a fork in the architecture: it is declarative,
   * greppable and testable, and a category cannot end up with an
   * unsubscribe link on a notice that shouldn't have one.
   *
   * `false` means the senders never consult the preferences table for
   * this category, so a stray row can't silence it either.
   *
   * The line is the CAN-SPAM one. A "due in two days" nudge is a
   * courtesy and is opt-out-able. "You are holding club gear that is
   * three weeks overdue" is a relationship message about club property
   * the member is holding — exempt from the opt-out requirement, and the
   * club's only way to reach them.
   */
  suppressible: boolean;
  /**
   * Shown beside a non-suppressible category instead of a switch, so the
   * list reads as complete rather than mysteriously short. Required
   * exactly when `suppressible` is false.
   */
  alwaysOnReason?: string;
}

export const NOTIFICATION_CATEGORIES = {
  "gear.loan_due_soon": {
    label: "Gear due soon",
    description:
      "A reminder a couple of days before club gear you've borrowed is due back.",
    defaultEnabled: true,
    suppressible: true,
  },
  "gear.loan_overdue": {
    label: "Overdue gear",
    description:
      "Notices when gear you've borrowed is past due, including when that starts affecting what you can check out.",
    defaultEnabled: true,
    suppressible: false,
    alwaysOnReason:
      "You'll always be told when you're holding overdue club gear.",
  },
} as const satisfies Record<string, NotificationCategoryMeta>;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export const NOTIFICATION_CATEGORY_KEYS = Object.keys(
  NOTIFICATION_CATEGORIES,
) as NotificationCategory[];

export function isNotificationCategory(
  value: string,
): value is NotificationCategory {
  return Object.hasOwn(NOTIFICATION_CATEGORIES, value);
}

/**
 * Whether a member is allowed to turn this category off.
 *
 * Senders call this *before* reading preferences — a non-suppressible
 * category skips the table entirely rather than reading it and ignoring
 * the answer, so there is no path by which a row silences one.
 */
export function isSuppressible(category: NotificationCategory): boolean {
  return NOTIFICATION_CATEGORIES[category].suppressible;
}
