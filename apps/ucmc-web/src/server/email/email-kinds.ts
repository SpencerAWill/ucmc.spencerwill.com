/**
 * What kinds of email this site sends.
 *
 * The dimension `email_sends.kind` records, and deliberately **wider
 * than the notification registry**: that registry describes mail a
 * member can express a preference about, and not all mail is like that.
 * A magic link is how someone signs in — there is no version of this
 * product where it is switchable — so it has no category there and
 * still has to be counted here.
 *
 * Keeping the two separate also keeps the counter honest about what it
 * is. `NOTIFICATION_CATEGORIES` answers "what may a member switch off";
 * this answers "what did we send". Collapsing them would make the
 * volume figures silently exclude every piece of mail that isn't
 * optional, which is most of the important mail.
 *
 * Pure data, no DB import, so the sender and the rollup can both read
 * it.
 */
import type { NotificationCategory } from "#/server/notifications/notification-registry";

/**
 * Mail that exists outside the notification registry because a member
 * cannot opt out of it. Prefixed to stay visibly distinct from
 * registry keys in the stored column.
 */
export const NON_NOTIFICATION_EMAIL_KINDS = ["auth.magic_link"] as const;

export type NonNotificationEmailKind =
  (typeof NON_NOTIFICATION_EMAIL_KINDS)[number];

/**
 * Every value `email_sends.kind` may hold: a notification category, or
 * one of the kinds above.
 *
 * Typed as a union rather than `string` so a send site cannot invent a
 * kind that no report knows how to label — the rollup groups by this
 * column, and an unrecognised value becomes a mystery bar.
 */
export type EmailKind = NotificationCategory | NonNotificationEmailKind;
