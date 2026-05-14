/**
 * Single source-of-truth for every runtime-editable site setting.
 *
 * Each entry pairs a zod schema with typed metadata. The schema decides
 * what shape `value_json` can hold; the metadata feeds the admin UI
 * (label, description, category) and the hygiene tray (owner, expiresAt).
 *
 * Adding a new setting:
 *   1. Drop a key/schema/metadata triple into `SETTINGS` below.
 *   2. Read it anywhere via `readSetting("the.key")` — return type is
 *      narrowed from the schema, typos are compile errors.
 *
 * No DB migration is required: the underlying column is `value_json TEXT`
 * and the schema is the only contract over its shape. No new mutation
 * hook, no new audit-action — the audit row is keyed by setting key and
 * its metadata varies by value type (booleans logged with value, other
 * shapes logged with key only — see settings-actions.server.ts).
 *
 * Client-safe: no DB imports here. Server modules pull this file for
 * validation; the admin UI pulls it for rendering. Pure schemas + data.
 */
import { z } from "zod";

// ── Categories: groups rendered as sections on /settings ────────────────
export const SETTING_CATEGORIES = [
  "contact",
  "platform",
  "integrations",
  "appearance",
  "legal",
] as const;
export type SettingCategory = (typeof SETTING_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SettingCategory, string> = {
  contact: "Contact",
  platform: "Platform",
  integrations: "Integrations",
  appearance: "Appearance",
  legal: "Legal",
};

// ── Metadata shape ──────────────────────────────────────────────────────
//
// Lifecycle fields are optional and apply to ANY setting — not just flags.
// A composite "maintenance window" config can age out just as much as a
// boolean kill switch. The Fowler taxonomy (`flagKind`) is preserved so
// the page can render a flag's purpose alongside the toggle.
//
// The `editor` field is reserved for freeform shapes where the default
// auto-form renderers can't produce a good UX. Left untyped here — the
// settings page narrows it at the render boundary. Most settings will
// leave it unset and rely on schema introspection (boolean → switch,
// string → input, object → recursive field list, etc.).
//
// We deliberately do NOT thread a per-schema type parameter through this
// metadata: TypeScript can't carry per-entry value types through a single
// homogeneous `SETTINGS` map without large gymnastics, and the value/
// onChange contract is already enforced at runtime by the zod schema.
export type SettingMeta = {
  label: string;
  description: string;
  category: SettingCategory;

  /** Owning role or person; surfaced on the stale-review tray. */
  owner?: string;
  /** Flag taxonomy — only meaningful when the schema is `z.boolean()`. */
  flagKind?: "ops" | "release" | "experiment" | "permission";
  /** ISO date (YYYY-MM-DD). Informational. */
  createdAt?: string;
  /** ISO date. When past, page surfaces a "Stale — review" badge. */
  expiresAt?: string;
  /**
   * Optional custom editor key. The settings page maps this to a
   * component at render time. Add cases there when introducing a new
   * editor; the registry just records the key. Most entries leave this
   * undefined and pick up the schema-introspection default.
   */
  editor?: string;
};

const registry = z.registry<SettingMeta>();

// ── The settings map ────────────────────────────────────────────────────
//
// IMPORTANT: keys here are also the on-the-wire `key` value sent to the
// update server fn AND the row key in `site_settings`. Use dotted lower-
// snake-ish strings so the audit log reads naturally.
//
// All schemas declare a `.default(...)` so `schema.parse(undefined)`
// produces the fallback value when the D1 row is absent or malformed.
// This is the fail-open contract documented in settings-repo.server.ts.
export const SETTINGS = {
  "contact.clubEmail": z
    .string()
    .trim()
    .email("Must be a valid email address")
    .default("ucmountaineering@gmail.com")
    .register(registry, {
      label: "Club email",
      description:
        "Public contact address for the club. Shown on the landing page meeting block and in the footer mail icon.",
      category: "contact",
    }),
} as const;

// ── Derived types ───────────────────────────────────────────────────────
export type SettingsMap = typeof SETTINGS;
export type SettingKey = keyof SettingsMap;
export type SettingValue<TKey extends SettingKey> = z.infer<SettingsMap[TKey]>;

export function isSettingKey(value: string): value is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, value);
}

export function getMeta<TKey extends SettingKey>(key: TKey): SettingMeta {
  // `registry.get()` returns the metadata associated with the schema.
  // We register every entry above, so this is non-nullable in practice;
  // the `!` is the documented assertion (Zod's typing returns
  // `Meta | undefined` to cover unregistered schemas).
  return registry.get(SETTINGS[key])!;
}

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

// ── Group keys by category for UI iteration ────────────────────────────
export function keysByCategory(): Record<SettingCategory, SettingKey[]> {
  const out: Record<SettingCategory, SettingKey[]> = {
    contact: [],
    platform: [],
    integrations: [],
    appearance: [],
    legal: [],
  };
  for (const key of SETTING_KEYS) {
    out[getMeta(key).category].push(key);
  }
  return out;
}

// ── Discriminated union for the wire validator ──────────────────────────
//
// Used by `updateSettingFn`'s `.inputValidator(...)`. Auto-derived from
// the registry — adding a setting to `SETTINGS` above extends this union
// without any other edit.
export type UpdateSettingInput = {
  [K in SettingKey]: { key: K; value: SettingValue<K> };
}[SettingKey];

/**
 * Runtime parser for `UpdateSettingInput`. Validates that `data.key` is a
 * known setting and that `data.value` parses against that key's schema.
 *
 * Hand-rolled rather than expressed as `z.discriminatedUnion(...)` because
 * Zod 4's discriminated-union builder is strict about element-tuple types,
 * and the registry's value-side schemas are heterogeneous (string, email,
 * url, boolean, future objects). The narrow per-key parse below gives the
 * same runtime guarantees with simpler typing.
 */
export const updateSettingInputSchema: z.ZodType<UpdateSettingInput> = z
  .object({ key: z.string(), value: z.unknown() })
  .superRefine((data, ctx) => {
    if (!isSettingKey(data.key)) {
      ctx.addIssue({
        code: "custom",
        message: `Unknown setting key: ${data.key}`,
        path: ["key"],
      });
      return;
    }
    const result = SETTINGS[data.key].safeParse(data.value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ ...issue, path: ["value", ...issue.path] });
      }
    }
  }) as unknown as z.ZodType<UpdateSettingInput>;

// ── Lifecycle helpers ───────────────────────────────────────────────────
/**
 * `true` when `value` deep-equals the registry's schema default for the
 * given key. Used by the admin UI to flag settings that have been
 * actively touched (more interesting at a glance than untouched ones).
 *
 * Deep-equality is approximated by JSON serialization. That's correct
 * for every shape the registry can hold today (strings, booleans,
 * numbers, arrays, plain objects), and degrades gracefully for any
 * future shape — a false negative just shows "Custom" on a value that
 * round-tripped through serialization-with-different-key-order, which
 * is a benign overestimate.
 */
export function isDefault<TKey extends SettingKey>(
  key: TKey,
  value: SettingValue<TKey>,
): boolean {
  const defaultValue = SETTINGS[key].parse(undefined);
  return JSON.stringify(value) === JSON.stringify(defaultValue);
}

/**
 * A setting is "stale" when its `expiresAt` is in the past. Used by the
 * admin page to surface a "Needs review" tray per category.
 */
export function isStale(meta: SettingMeta, now: Date = new Date()): boolean {
  if (!meta.expiresAt) return false;
  const expires = Date.parse(meta.expiresAt);
  if (Number.isNaN(expires)) return false;
  return expires < now.getTime();
}
