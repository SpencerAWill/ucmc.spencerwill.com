/**
 * Query options factories for the /settings admin surface.
 */
import {
  PUBLIC_SITE_CONTACT_QUERY_KEY,
  SITE_SETTINGS_QUERY_KEY,
} from "./query-keys";
import {
  getPublicSiteContactFn,
  listSiteSettingsFn,
} from "#/features/settings/server/settings-fns";
import type { PublicSiteContact } from "#/features/settings/server/settings-fns";
import { SETTINGS } from "#/features/settings/server/settings-registry";

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
