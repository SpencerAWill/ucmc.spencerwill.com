/**
 * The caller's own notification preferences: read the whole list, flip
 * one switch.
 *
 * Account self-service, so it lives beside the email and passkey actions
 * rather than in the feature that happens to send the first
 * notification. The registry and the storage adapter are in
 * `src/server/notifications/` because the senders need them too, and
 * features can't import each other.
 *
 * **Every category is returned, including the ones that can't be turned
 * off.** A preferences list that silently omits the overdue-gear notice
 * would leave a member believing the club can't contact them about gear
 * they're holding. The non-suppressible ones come back with
 * `suppressible: false` and a reason, and the UI renders them as a
 * stated fact rather than a control.
 *
 * Writes are deliberately **not** audited — see the repo's module
 * comment.
 */
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_KEYS,
  isNotificationCategory,
} from "#/server/notifications/notification-registry";
import type {
  NotificationCategory,
  NotificationChannel,
} from "#/server/notifications/notification-registry";
import {
  listPreferencesForUser,
  setNotificationPreference,
} from "#/server/notifications/notification-prefs-repo.server";

/**
 * Email is the only channel, so the actions take no channel argument
 * rather than accepting one value and pretending to be general. When a
 * second channel lands, this constant is what the signatures grow out
 * of.
 */
const CHANNEL: NotificationChannel = "email";

export interface NotificationPreferenceRow {
  category: NotificationCategory;
  label: string;
  description: string;
  /** Resolved: the member's explicit choice, else the registry default. */
  enabled: boolean;
  suppressible: boolean;
  /** Present exactly when `suppressible` is false. */
  alwaysOnReason: string | null;
}

export type ListMyNotificationPreferencesResult =
  | { ok: true; rows: NotificationPreferenceRow[] }
  | { ok: false; reason: "unauthorized" };

export async function listMyNotificationPreferencesAction(): Promise<ListMyNotificationPreferencesResult> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    return { ok: false, reason: "unauthorized" };
  }
  const explicit = await listPreferencesForUser(principal.userId);
  const rows = NOTIFICATION_CATEGORY_KEYS.map((category) => {
    const meta = NOTIFICATION_CATEGORIES[category];
    return {
      category,
      label: meta.label,
      description: meta.description,
      // A non-suppressible category reads as on whatever the table says,
      // matching what the senders actually do — they never consult it.
      enabled: meta.suppressible
        ? (explicit.get(`${category}:${CHANNEL}`) ?? meta.defaultEnabled)
        : true,
      suppressible: meta.suppressible,
      // Not `?? null`: `suppressible` is a literal per registry entry,
      // so this branch is narrowed to the categories that carry a
      // reason. A new non-suppressible category that forgets one is
      // then a type error here, which is where it should surface.
      alwaysOnReason: meta.suppressible ? null : meta.alwaysOnReason,
    };
  });
  return { ok: true, rows };
}

export type SetMyNotificationPreferenceResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unauthorized" | "unknown_category" | "not_suppressible";
    };

export async function setMyNotificationPreferenceAction(input: {
  category: string;
  enabled: boolean;
}): Promise<SetMyNotificationPreferenceResult> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    return { ok: false, reason: "unauthorized" };
  }
  if (!isNotificationCategory(input.category)) {
    return { ok: false, reason: "unknown_category" };
  }
  // Refused rather than ignored. Silently accepting a write that the
  // senders will never read is how a member ends up believing they
  // opted out of something that keeps arriving.
  if (!NOTIFICATION_CATEGORIES[input.category].suppressible) {
    return { ok: false, reason: "not_suppressible" };
  }
  await setNotificationPreference({
    userId: principal.userId,
    category: input.category,
    channel: CHANNEL,
    enabled: input.enabled,
    source: "user",
  });
  return { ok: true };
}
