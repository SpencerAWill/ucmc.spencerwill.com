/**
 * Storage adapter for `site_settings`. Two responsibilities:
 *
 *   1. `readSetting(key)` — fail-open read. Returns the schema's default
 *      whenever the row is missing, the JSON is malformed, the stored
 *      value fails its zod schema, or D1 throws. The whole point of a
 *      runtime settings table is that the site keeps working when the
 *      table is empty (fresh DB) or partially-populated (after a wipe).
 *
 *   2. `writeSettingStatement(key, value, actorUserId)` — returns the
 *      prepared UPSERT statement so the action layer can batch it with
 *      the audit event for atomicity. Mirrors the
 *      `buildAuditEventStatement` shape so the parent action's `db.batch`
 *      is symmetric.
 *
 * All shape decisions live in `settings-registry.ts`. This file only
 * knows "read a key, write a key" — it has no opinion on what each key
 * means.
 */
import { eq } from "drizzle-orm";

import * as schema from "../../../drizzle/schema";
import { getDb } from "#/server/db";
import { SETTINGS } from "./settings-registry";
import type { SettingKey, SettingValue } from "./settings-registry";

/**
 * Keys renamed by migration `0064`, mapped current → pre-`0064`. The
 * fail-open contract makes a rename dangerous in exactly the skew this
 * covers: against a database that hasn't run `0064`, the new key finds no
 * row and falls back to the registry default (`true` for the feedback
 * gate), silently *reopening* an intake an admin had paused. Reading
 * through to the old key keeps the stored value authoritative until the
 * migration lands.
 *
 * Same reasoning and the same lifetime as
 * `src/server/auth/permission-aliases.ts` — **delete both once `0064` is
 * applied to dev and prod.**
 */
const LEGACY_SETTING_KEYS: Partial<Record<SettingKey, string>> = {
  "feedback.site_enabled": "feedback.website_enabled",
};

/**
 * Read a setting from D1. Returns the schema's default whenever:
 *   - the row doesn't exist,
 *   - the stored JSON is unparseable,
 *   - the parsed value fails the registry schema,
 *   - the D1 query throws (cold connection, transient outage).
 *
 * The fail-open contract matches how Turnstile and rate-limit wrappers
 * fail in this codebase — infrastructure hiccups don't lock users out.
 */
export async function readSetting<TKey extends SettingKey>(
  key: TKey,
): Promise<SettingValue<TKey>> {
  const schemaForKey = SETTINGS[key];
  const fallback = (): SettingValue<TKey> =>
    schemaForKey.parse(undefined) as SettingValue<TKey>;
  try {
    const db = getDb();
    let row = await db
      .select()
      .from(schema.siteSettings)
      .where(eq(schema.siteSettings.key, key))
      .get();
    const legacyKey = LEGACY_SETTING_KEYS[key];
    if (!row && legacyKey !== undefined) {
      row = await db
        .select()
        .from(schema.siteSettings)
        .where(eq(schema.siteSettings.key, legacyKey))
        .get();
    }
    if (!row) return fallback();
    let raw: unknown;
    try {
      raw = JSON.parse(row.valueJson);
    } catch {
      return fallback();
    }
    const parsed = schemaForKey.safeParse(raw);
    return parsed.success ? (parsed.data as SettingValue<TKey>) : fallback();
  } catch {
    return fallback();
  }
}

/**
 * Per-key snapshot: value plus the metadata the admin UI uses for the
 * "Last edited …" footer. `updatedAtMs` is a unix-ms number on the wire
 * (createServerFn doesn't reliably round-trip `Date` across the worker
 * boundary). `updatedByName` is the actor's display name from
 * `profiles.fullName`, joined here so the client doesn't make N profile
 * fetches; `null` when no row exists, the actor cascaded to NULL, or
 * the profile is missing.
 */
export type SiteSettingEntry<TKey extends SettingKey> = {
  value: SettingValue<TKey>;
  updatedAtMs: number | null;
  updatedByName: string | null;
};

export type SiteSettingsEntries = {
  [TKey in SettingKey]: SiteSettingEntry<TKey>;
};

/**
 * Eager-load every registered setting plus its edit metadata in one
 * round-trip (LEFT JOIN profiles for the actor's display name). The
 * /settings route hydrates the page with this; reading rows + actor
 * names individually would be O(N) queries per render. Missing rows
 * fall back to the registry default per key (same fail-open semantics
 * as `readSetting`) with `updatedAtMs`/`updatedByName` set to `null`.
 */
export async function readAllSettings(): Promise<SiteSettingsEntries> {
  type Row = {
    key: string;
    valueJson: string;
    updatedAt: Temporal.Instant;
    updatedByName: string | null;
  };
  let rowsByKey = new Map<string, Row>();
  try {
    const rows = await getDb()
      .select({
        key: schema.siteSettings.key,
        valueJson: schema.siteSettings.valueJson,
        updatedAt: schema.siteSettings.updatedAt,
        updatedByName: schema.profiles.fullName,
      })
      .from(schema.siteSettings)
      .leftJoin(
        schema.profiles,
        eq(schema.profiles.userId, schema.siteSettings.updatedBy),
      )
      .all();
    rowsByKey = new Map(rows.map((r) => [r.key, r]));
  } catch {
    // D1 hiccup — every key falls back to its schema default below.
  }

  // The `out` cast pattern below uses a record over plain `unknown`
  // because TypeScript collapses `SiteSettingsEntries[SettingKey]` to
  // `never` on indexed assignment (each registry entry's value type
  // differs, and TS picks the intersection). Each assignment is locally
  // type-correct — the parse-or-default branch yields the right shape
  // per key — but TS can't carry that through a single uniform loop.
  // We surface the typed result at the function boundary with `as`.
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(SETTINGS) as SettingKey[]) {
    const legacyKey = LEGACY_SETTING_KEYS[k];
    const stored =
      rowsByKey.get(k) ??
      (legacyKey === undefined ? undefined : rowsByKey.get(legacyKey));
    if (stored === undefined) {
      out[k] = {
        value: SETTINGS[k].parse(undefined),
        updatedAtMs: null,
        updatedByName: null,
      };
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(stored.valueJson);
    } catch {
      out[k] = {
        value: SETTINGS[k].parse(undefined),
        updatedAtMs: stored.updatedAt.epochMilliseconds,
        updatedByName: stored.updatedByName,
      };
      continue;
    }
    const parsed = SETTINGS[k].safeParse(raw);
    out[k] = {
      value: parsed.success ? parsed.data : SETTINGS[k].parse(undefined),
      updatedAtMs: stored.updatedAt.epochMilliseconds,
      updatedByName: stored.updatedByName,
    };
  }
  return out as SiteSettingsEntries;
}

/**
 * Returns the prepared UPSERT statement. Caller spreads into a
 * `db.batch([...])` together with the audit event. Re-validates the
 * value against its registry schema before constructing the statement so
 * a buggy caller can't write rows that subsequent reads would reject.
 */
export function writeSettingStatement<TKey extends SettingKey>(
  key: TKey,
  value: SettingValue<TKey>,
  actorUserId: string,
) {
  SETTINGS[key].parse(value);
  const valueJson = JSON.stringify(value);
  return getDb()
    .insert(schema.siteSettings)
    .values({
      key,
      valueJson,
      updatedBy: actorUserId,
    })
    .onConflictDoUpdate({
      target: schema.siteSettings.key,
      set: {
        valueJson,
        updatedAt: Temporal.Now.instant(),
        updatedBy: actorUserId,
      },
    });
}
