/**
 * Read-side action for /settings. Kept separate from
 * `settings-actions.server.ts` (which holds mutations) so a future
 * member-side "public settings" reader can share the same repo without
 * inheriting the `settings:manage` gate.
 *
 * Today the admin UI is the only caller, so this still gates on
 * `settings:manage`.
 */
import { and, desc, eq } from "drizzle-orm";

import * as schema from "../../../../drizzle/schema";
import { getDb } from "#/server/db";
import { requireSettingsManager } from "./permissions.server";
import {
  readAllSettings,
  readSetting,
} from "#/server/settings/settings-repo.server";
import { isSettingKey, SETTINGS } from "#/server/settings/settings-registry";
import type { SettingKey } from "#/server/settings/settings-registry";
import type {
  PublicFlags,
  PublicSiteContact,
  SettingHistoryEntry,
  SiteSettingsSnapshot,
} from "./settings-fns";

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

/**
 * Curated public-read of feature-flag state. No auth. The set of flags
 * exposed here is hand-maintained — every entry corresponds to a boolean
 * setting in the registry whose value the sidebar / bell / public-facing
 * UI needs to consult synchronously. Anyone can read these; "this
 * feature is off" is the same answer the gated route already returns.
 */
export async function getPublicFlagsAction(): Promise<PublicFlags> {
  const [
    announcements,
    websiteFeedback,
    clubFeedback,
    gearCave,
    scholarships,
    policies,
    resources,
    gallery,
    gazette,
    history,
    blog,
    volunteer,
    calendar,
    forum,
    analytics,
    reports,
  ] = await Promise.all([
    readSetting("announcements.enabled"),
    readSetting("feedback.website_enabled"),
    readSetting("feedback.club_enabled"),
    readSetting("pages.gear_cave"),
    readSetting("pages.scholarships"),
    readSetting("pages.policies"),
    readSetting("pages.resources"),
    readSetting("pages.gallery"),
    readSetting("pages.gazette"),
    readSetting("pages.history"),
    readSetting("pages.blog"),
    readSetting("pages.volunteer"),
    readSetting("pages.calendar"),
    readSetting("pages.forum"),
    readSetting("pages.analytics"),
    readSetting("pages.reports"),
  ]);
  return {
    announcements,
    websiteFeedback,
    clubFeedback,
    gearCave,
    scholarships,
    policies,
    resources,
    gallery,
    gazette,
    history,
    blog,
    volunteer,
    calendar,
    forum,
    analytics,
    reports,
  };
}

/**
 * Per-setting audit history. Returns the last N `settings_updated` rows
 * for a given key, joined to `profiles.full_name` for actor display.
 * Gated by `settings:manage` — same surface as the rest of the admin
 * read API.
 *
 * Value rendering uses the same policy as the audit recorder: boolean
 * values come back populated, every other shape returns `null` (the
 * audit row never stored a value for those — see settings-actions
 * for the metadata policy).
 */
const HISTORY_LIMIT = 50;

export async function listSettingHistoryAction(input: {
  key: SettingKey;
}): Promise<SettingHistoryEntry[]> {
  await requireSettingsManager();
  if (!isSettingKey(input.key)) return [];
  // Defense in depth — the gate above is the real boundary, but
  // referencing SETTINGS[key] here makes the loop below total over
  // every registered key.
  if (!Object.prototype.hasOwnProperty.call(SETTINGS, input.key)) return [];

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
    let parsedValue: boolean | null = null;
    if (r.metadataJson) {
      try {
        const parsed = JSON.parse(r.metadataJson) as {
          key?: unknown;
          value?: unknown;
        };
        if (typeof parsed.value === "boolean") parsedValue = parsed.value;
      } catch {
        // Audit metadata is officer-trusted but if anything ever writes
        // malformed JSON we shouldn't crash the history view.
      }
    }
    return {
      id: r.id,
      atMs: r.createdAt.epochMilliseconds,
      actorName: r.actorName,
      booleanValue: parsedValue,
    };
  });
}
