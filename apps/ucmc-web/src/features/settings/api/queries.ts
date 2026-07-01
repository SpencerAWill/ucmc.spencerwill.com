/**
 * Query options factories for the /settings admin surface.
 */
import {
  PUBLIC_FLAGS_QUERY_KEY,
  PUBLIC_SITE_CONTACT_QUERY_KEY,
  settingHistoryQueryKey,
  SITE_SETTINGS_QUERY_KEY,
} from "./query-keys";
import {
  getPublicFlagsFn,
  getPublicSiteContactFn,
  listSettingHistoryFn,
  listSiteSettingsFn,
} from "#/features/settings/server/settings-fns";
import type {
  PublicFlags,
  PublicSiteContact,
} from "#/features/settings/server/settings-fns";
import { SETTINGS } from "#/server/settings/settings-registry";
import type { SettingKey } from "#/server/settings/settings-registry";

export function siteSettingsQueryOptions() {
  return {
    queryKey: SITE_SETTINGS_QUERY_KEY,
    queryFn: () => listSiteSettingsFn(),
  } as const;
}

/**
 * Public-read for the footer + landing page. `placeholderData` matches
 * the schema default so signed-out visitors see correct values
 * pre-hydration / before the query resolves.
 */
export function publicSiteContactQueryOptions() {
  const fallback: PublicSiteContact = {
    clubEmail: SETTINGS["contact.clubEmail"].parse(undefined),
  };
  return {
    queryKey: PUBLIC_SITE_CONTACT_QUERY_KEY,
    queryFn: () => getPublicSiteContactFn(),
    placeholderData: fallback,
  } as const;
}

/**
 * Feature-flag snapshot for client-side gating (sidebar nav, header
 * bell, anywhere a feature's UI needs to disappear synchronously).
 * `placeholderData` is the schema-default snapshot so pre-hydration /
 * pre-query renders see the same answer the server would return for a
 * cold DB — that means features default to off until proven on.
 */
export function publicFlagsQueryOptions() {
  const fallback: PublicFlags = {
    announcements: SETTINGS["announcements.enabled"].parse(undefined),
    websiteFeedback: SETTINGS["feedback.website_enabled"].parse(undefined),
    clubFeedback: SETTINGS["feedback.club_enabled"].parse(undefined),
  };
  return {
    queryKey: PUBLIC_FLAGS_QUERY_KEY,
    queryFn: () => getPublicFlagsFn(),
    placeholderData: fallback,
  } as const;
}

/**
 * Per-setting audit history. Lazy — only fired when the user opens the
 * history dialog for a given row (the component sets `enabled` via
 * mount). Officer-gated server-side.
 */
export function settingHistoryQueryOptions(
  key: SettingKey,
  options: { enabled?: boolean } = {},
) {
  return {
    queryKey: settingHistoryQueryKey(key),
    queryFn: () => listSettingHistoryFn({ data: { key } }),
    enabled: options.enabled ?? true,
  } as const;
}
