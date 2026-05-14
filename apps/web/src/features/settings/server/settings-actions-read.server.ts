/**
 * Read-side action for /settings. Kept separate from
 * `settings-actions.server.ts` (which holds mutations) so a future
 * member-side "public settings" reader can share the same repo without
 * inheriting the `settings:manage` gate.
 *
 * Today the admin UI is the only caller, so this still gates on
 * `settings:manage`.
 */
import { requireSettingsManager } from "./permissions.server";
import { readAllSettings, readSetting } from "./settings-repo.server";
import type { PublicSiteContact, SiteSettingsSnapshot } from "./settings-fns";

export async function listSiteSettingsAction(): Promise<SiteSettingsSnapshot> {
  await requireSettingsManager();
  return readAllSettings();
}

/**
 * Curated public-read of the contact subset. No auth — these are already
 * displayed on the landing page and footer to anyone. The allowlist lives
 * here, not in metadata, so a category typo can't change which values
 * leak publicly.
 */
export async function getPublicSiteContactAction(): Promise<PublicSiteContact> {
  const clubEmail = await readSetting("contact.clubEmail");
  return { clubEmail };
}
