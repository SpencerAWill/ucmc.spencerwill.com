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

import * as schema from "../../../../drizzle/schema";
import { getDb } from "#/server/db";
import { SETTINGS } from "./settings-registry";
import type { SettingKey, SettingValue } from "./settings-registry";

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
    const row = await getDb()
      .select()
      .from(schema.siteSettings)
      .where(eq(schema.siteSettings.key, key))
      .get();
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
 * Eager-load every registered setting in one round-trip. The /settings
 * route uses this to hydrate its form state; reading them individually
 * would be N queries per page render. Missing rows fall back to the
 * registry default per key (same fail-open semantics as `readSetting`).
 */
export async function readAllSettings(): Promise<{
  [K in SettingKey]: SettingValue<K>;
}> {
  const out = {} as { [K in SettingKey]: SettingValue<K> };
  let rowsByKey = new Map<string, string>();
  try {
    const rows = await getDb()
      .select({
        key: schema.siteSettings.key,
        valueJson: schema.siteSettings.valueJson,
      })
      .from(schema.siteSettings)
      .all();
    rowsByKey = new Map(rows.map((r) => [r.key, r.valueJson]));
  } catch {
    // D1 hiccup — every key falls back to its schema default below.
  }
  for (const k of Object.keys(SETTINGS) as SettingKey[]) {
    const stored = rowsByKey.get(k);
    if (stored === undefined) {
      out[k] = SETTINGS[k].parse(undefined);
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(stored);
    } catch {
      out[k] = SETTINGS[k].parse(undefined);
      continue;
    }
    const parsed = SETTINGS[k].safeParse(raw);
    out[k] = parsed.success ? parsed.data : SETTINGS[k].parse(undefined);
  }
  return out;
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
        updatedAt: new Date(),
        updatedBy: actorUserId,
      },
    });
}
