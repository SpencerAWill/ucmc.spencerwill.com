/**
 * Read-side action for /settings. Kept separate from
 * `settings-actions.server.ts` (which holds mutations) so a future
 * member-side "public settings" reader can share the same repo without
 * inheriting the `settings:manage` gate.
 *
 * The admin reads are gated per key: the list returns only the settings
 * the caller can edit, and history checks the key asked about.
 */
import { and, desc, eq } from "drizzle-orm";

import * as schema from "../../../../drizzle/schema";
import { getDb } from "#/server/db";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import {
  requireAnySettingPermission,
  requireSettingPermission,
} from "./permissions.server";
import {
  readAllSettings,
  readSetting,
} from "#/server/settings/settings-repo.server";
import {
  canEditSetting,
  effectivePageFlags,
  isSettingKey,
  pageFlagKeyOf,
  PAGE_SETTING_KEYS,
} from "#/server/settings/settings-registry";
import type { SettingKey } from "#/server/settings/settings-registry";
import {
  noticeViewerOf,
  resolveSiteNotice,
} from "#/server/settings/site-notice";
import type { SiteNotice } from "#/server/settings/site-notice";
import type {
  PublicBranding,
  PublicFlags,
  PublicSiteContact,
  SettingHistoryEntry,
  SiteSettingsSnapshot,
} from "./settings-fns";

/**
 * Every setting the caller can edit, with its edit metadata. Filtered per
 * key, so a `notice:manage`-only officer gets the four `notice.*` entries
 * and never sees the values of settings they can't change.
 */
export async function listSiteSettingsAction(): Promise<SiteSettingsSnapshot> {
  const principal = await requireAnySettingPermission();
  const all = await readAllSettings();
  return Object.fromEntries(
    Object.entries(all).filter(([key]) =>
      canEditSetting(principal.permissions, key as SettingKey),
    ),
  );
}

/**
 * Curated public-read of the contact subset. No auth — these are already
 * displayed on the landing page and footer to anyone. The allowlist lives
 * here, not in metadata, so a category typo can't change which values
 * leak publicly.
 */
export async function getPublicSiteContactAction(): Promise<PublicSiteContact> {
  const [clubEmail, instagramUrl, facebookUrl, youtubeUrl] = await Promise.all([
    readSetting("contact.clubEmail"),
    readSetting("contact.instagramUrl"),
    readSetting("contact.facebookUrl"),
    readSetting("contact.youtubeUrl"),
  ]);
  return { clubEmail, instagramUrl, facebookUrl, youtubeUrl };
}

/**
 * Curated public-read of the header masthead strings. No auth — this
 * text is on every page for everyone. Allowlisted here rather than
 * derived from the `appearance` category, same as the contact subset:
 * a category typo must not be able to change what leaks publicly.
 */
export async function getPublicBrandingAction(): Promise<PublicBranding> {
  const [headerTitle, headerTagline] = await Promise.all([
    readSetting("appearance.headerTitle"),
    readSetting("appearance.headerTagline"),
  ]);
  return { headerTitle, headerTagline };
}

/**
 * The site notice this caller should see, or `null`. No auth gate, but
 * unlike the other public reads the answer depends on who is asking: a
 * members-only notice is decided away here, on the server, so its text
 * never ships to a signed-out browser — not in the SSR HTML and not in
 * the dehydrated query cache. Its own allowlisted payload, like the
 * contact and branding reads; `resolveSiteNotice` holds the policy.
 */
export async function getSiteNoticeAction(): Promise<SiteNotice | null> {
  const [enabled, text, audience, tone, principal] = await Promise.all([
    readSetting("notice.enabled"),
    readSetting("notice.text"),
    readSetting("notice.audience"),
    readSetting("notice.tone"),
    loadCurrentPrincipal(),
  ]);
  return resolveSiteNotice(
    { enabled, text, audience, tone },
    noticeViewerOf(principal),
  );
}

/**
 * Curated public-read of feature-flag state. No auth. The set of flags
 * exposed here is hand-maintained — every entry corresponds to a boolean
 * setting in the registry whose value the sidebar / tab bars /
 * public-facing UI need to consult synchronously. Anyone can read these; "this
 * feature is off" is the same answer the gated route already returns.
 */
export async function getPublicFlagsAction(): Promise<PublicFlags> {
  const [siteFeedback, clubFeedback, pageValues] = await Promise.all([
    readSetting("site_feedback.submissions_enabled"),
    readSetting("club_feedback.submissions_enabled"),
    Promise.all(PAGE_SETTING_KEYS.map((key) => readSetting(key))),
  ]);
  const raw = Object.fromEntries(
    PAGE_SETTING_KEYS.map((key, i) => [pageFlagKeyOf(key), pageValues[i]]),
  ) as PublicFlags["pages"];
  // Effective, not raw: a page is on only when its own switch and every
  // ancestor section's are on. Folding the cascade in here is what gives
  // the sidebar, the tab bars, and every route guard the same answer —
  // they all read this map, so none of them can forget to check the
  // parent. `/settings` deliberately reads raw values via
  // `listSiteSettingsAction` instead.
  return {
    siteFeedback,
    clubFeedback,
    pages: effectivePageFlags(raw),
  };
}

/**
 * Per-setting audit history. Returns the last N `settings_updated` rows
 * for a given key, joined to `profiles.full_name` for actor display.
 * Gated by the key's own permission — the same one that edits it.
 *
 * Value rendering uses the same policy as the audit recorder: boolean
 * and enum values come back populated, every other shape returns `null`
 * (the audit row never stored a value for those — see settings-actions
 * for the metadata policy).
 */
const HISTORY_LIMIT = 50;

export async function listSettingHistoryAction(input: {
  key: SettingKey;
}): Promise<SettingHistoryEntry[]> {
  if (!isSettingKey(input.key)) {
    await requireAnySettingPermission();
    return [];
  }
  await requireSettingPermission(input.key);

  const rows = await getDb()
    .select({
      id: schema.auditLog.id,
      createdAt: schema.auditLog.createdAt,
      actorUserId: schema.auditLog.actorUserId,
      actorName: schema.profiles.fullName,
      metadataJson: schema.auditLog.metadataJson,
    })
    .from(schema.auditLog)
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.auditLog.actorUserId),
    )
    .where(
      and(
        eq(schema.auditLog.action, "settings_updated"),
        eq(schema.auditLog.targetId, input.key),
      ),
    )
    // Tie-break by id because two edits in the same ms (common in
    // workerd test runs and possible in real bursts) would otherwise
    // come back in indeterminate order. uuidv7 ids are monotonically
    // time-sortable, so DESC id matches DESC time within the tie.
    .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
    .limit(HISTORY_LIMIT)
    .all();

  return rows.map((r) => {
    const parsedValue = auditValueOf(r.metadataJson);
    return {
      id: r.id,
      atMs: r.createdAt.epochMilliseconds,
      actorName: r.actorName,
      booleanValue: typeof parsedValue === "boolean" ? parsedValue : null,
      // Only enums record a string value; free text is logged key-only.
      enumValue: typeof parsedValue === "string" ? parsedValue : null,
    };
  });
}

/** The `value` an audit row recorded, or `null` for none / unreadable. */
function auditValueOf(metadataJson: string | null): unknown {
  if (!metadataJson) {
    return null;
  }
  try {
    const parsed = JSON.parse(metadataJson) as { value?: unknown };
    return parsed.value ?? null;
  } catch {
    // Audit metadata is officer-trusted but if anything ever writes
    // malformed JSON we shouldn't crash the history view.
    return null;
  }
}
