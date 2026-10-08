/**
 * Storage adapter for `user_notification_preferences`.
 *
 * Deliberately the mirror image of `settings-repo.server.ts` in one
 * respect, and it is the thing to read before changing anything here.
 *
 * **`readSetting` fails OPEN; these reads fail CLOSED.** A site setting
 * that can't be read falls back to its default so the site keeps working
 * on a fresh or flaky database. A notification preference that can't be
 * read resolves to "do not send", because the harm is asymmetric:
 * emailing somebody who opted out is the failure this table exists to
 * prevent, and a skipped courtesy nudge costs nothing — the member still
 * sees the banner on `/my/gear`, and the next rung of the ladder tries
 * again tomorrow. Without this inversion a D1 hiccup during the daily
 * cron would mail every opted-out member at once.
 *
 * Writes are **not** audited, unlike settings writes. The audit log is a
 * record of officer actions against the club; a member toggling their
 * own email preference would be noise in it. The row's `source` and
 * `updatedAt` are the record.
 */
import { and, eq } from "drizzle-orm";

import * as schema from "../../../drizzle/schema";
import type { NotificationPrefSource } from "../../../drizzle/schema";
import { getDb } from "#/server/db";
import { errorMessage, log } from "#/server/log/log.server";
import {
  NOTIFICATION_CATEGORIES,
  isSuppressible,
} from "./notification-registry";
import type {
  NotificationCategory,
  NotificationChannel,
} from "./notification-registry";

export type { NotificationPrefSource };

/**
 * Whether one member should receive one category on one channel.
 *
 * A non-suppressible category short-circuits to `true` without touching
 * the table — see `isSuppressible`. Everything else reads the sparse
 * row, falling back to the registry default when there isn't one.
 */
export async function shouldNotify(input: {
  userId: string;
  category: NotificationCategory;
  channel: NotificationChannel;
}): Promise<boolean> {
  if (!isSuppressible(input.category)) return true;
  try {
    const rows = await getDb()
      .select({ enabled: schema.userNotificationPreferences.enabled })
      .from(schema.userNotificationPreferences)
      .where(
        and(
          eq(schema.userNotificationPreferences.userId, input.userId),
          eq(schema.userNotificationPreferences.category, input.category),
          eq(schema.userNotificationPreferences.channel, input.channel),
        ),
      )
      .limit(1);
    return (
      rows.at(0)?.enabled ??
      NOTIFICATION_CATEGORIES[input.category].defaultEnabled
    );
  } catch (err: unknown) {
    log.error("notifications.pref_read_failed", {
      category: input.category,
      channel: input.channel,
      error: errorMessage(err),
    });
    // Fail closed. See the module comment.
    return false;
  }
}

/**
 * Every user id that has explicitly turned one category off.
 *
 * One query for a whole cron batch, which is what the
 * `(category, channel, enabled)` index exists for — the alternative is
 * a `shouldNotify` round trip per recipient.
 *
 * **Throws rather than returning an empty set on failure.** An empty set
 * reads as "nobody opted out", which is exactly the mistake that would
 * mail everyone; the caller is expected to abandon the run instead.
 */
export async function listSuppressedUserIds(input: {
  category: NotificationCategory;
  channel: NotificationChannel;
}): Promise<Set<string>> {
  const rows = await getDb()
    .select({ userId: schema.userNotificationPreferences.userId })
    .from(schema.userNotificationPreferences)
    .where(
      and(
        eq(schema.userNotificationPreferences.category, input.category),
        eq(schema.userNotificationPreferences.channel, input.channel),
        eq(schema.userNotificationPreferences.enabled, false),
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

/** One member's explicit choices, for rendering the preferences tab. */
export async function listPreferencesForUser(
  userId: string,
): Promise<Map<string, boolean>> {
  const rows = await getDb()
    .select({
      category: schema.userNotificationPreferences.category,
      channel: schema.userNotificationPreferences.channel,
      enabled: schema.userNotificationPreferences.enabled,
    })
    .from(schema.userNotificationPreferences)
    .where(eq(schema.userNotificationPreferences.userId, userId));
  return new Map(rows.map((r) => [`${r.category}:${r.channel}`, r.enabled]));
}

/**
 * Upsert one preference.
 *
 * A row is written even when the value matches the registry default. The
 * sparse-row contract is "absent means default", not "present means
 * changed" — keeping an explicit `true` lets a later change to the
 * default leave members who already made a choice where they put
 * themselves, which is the whole reason anyone touches the tab.
 */
export async function setNotificationPreference(input: {
  userId: string;
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
  source: NotificationPrefSource;
}): Promise<void> {
  await getDb()
    .insert(schema.userNotificationPreferences)
    .values({
      userId: input.userId,
      category: input.category,
      channel: input.channel,
      enabled: input.enabled,
      source: input.source,
    })
    .onConflictDoUpdate({
      target: [
        schema.userNotificationPreferences.userId,
        schema.userNotificationPreferences.category,
        schema.userNotificationPreferences.channel,
      ],
      set: {
        enabled: input.enabled,
        source: input.source,
        updatedAt: Temporal.Now.instant(),
      },
    });
}
