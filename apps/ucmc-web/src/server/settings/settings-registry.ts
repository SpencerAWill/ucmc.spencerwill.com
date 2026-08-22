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
// Categories double as section headings on /settings. The convention is
// per-feature scoping (`announcements`, `gear`, etc. — one section per
// feature that has any runtime config), with `contact` / `integrations` /
// `appearance` / `legal` reserved for cross-cutting concerns that don't
// belong to a single feature.
export const SETTING_CATEGORIES = [
  "contact",
  "pages",
  "feedback",
  "integrations",
  "appearance",
  "legal",
] as const;
export type SettingCategory = (typeof SETTING_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SettingCategory, string> = {
  contact: "Contact",
  pages: "Pages",
  feedback: "Feedback",
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
  /**
   * When set, the admin UI gates every save of this setting (toggle
   * flip OR text save OR reset-to-default) behind an AlertDialog
   * showing this message. Use for high-impact / hard-to-reverse changes
   * — kill switches that yank features for everyone, anything that
   * invalidates downstream state. Plain prose; the dialog supplies the
   * Cancel/Confirm buttons.
   */
  confirm?: string;
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

  // Per-page kill switches for sidebar pages. Seeded with the public-site
  // section (Gear Cave → History); intended to expand over time to cover
  // most sidebar pages (a handful — e.g. Settings, Audit — stay
  // permanently on and out of this category). Each flag composes with the
  // page's existing view permission: the sidebar entry renders only when
  // the flag is ON *and* the viewer holds the permission, and the route's
  // `beforeLoad` throws `notFound()` when the flag is OFF regardless of
  // permission — so a disabled page both disappears from the nav and 404s
  // on direct navigation. Defaults are ON so existing live pages stay
  // accessible after deploy; officers toggle individual pages off as
  // needed. Exposed via `getPublicFlagsFn` so the sidebar and route guards
  // can consult them synchronously. Blog and Volunteer have no route yet —
  // their flags only hide the "coming soon" sidebar entry.
  "pages.gear_cave": z.boolean().default(true).register(registry, {
    label: "Gear Cave enabled",
    description:
      "When off, the Gear Cave sidebar entry is hidden and the /gear-cave route returns notFound for everyone.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.scholarships": z.boolean().default(true).register(registry, {
    label: "Scholarships enabled",
    description:
      "When off, the Scholarships sidebar entry is hidden and the /scholarships route returns notFound for everyone.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.policies": z.boolean().default(true).register(registry, {
    label: "Policies enabled",
    description:
      "When off, the Policies sidebar entry is hidden and the /policies route returns notFound for everyone.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.resources": z.boolean().default(true).register(registry, {
    label: "Resources enabled",
    description:
      "When off, the Resources sidebar entry is hidden and the /resources route returns notFound for everyone.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.gallery": z.boolean().default(true).register(registry, {
    label: "Trip Gallery enabled",
    description:
      "When off, the Trip Gallery sidebar entry is hidden and the /gallery route returns notFound for everyone.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.gazette": z.boolean().default(true).register(registry, {
    label: "Goosedown Gazette enabled",
    description:
      "When off, the Goosedown Gazette sidebar entry is hidden and the /gazette routes return notFound for everyone.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.history": z.boolean().default(true).register(registry, {
    label: "History enabled",
    description:
      "When off, the History sidebar entry is hidden and the /history route returns notFound for everyone.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.blog": z.boolean().default(true).register(registry, {
    label: "Blog enabled",
    description:
      "When off, the Blog “coming soon” sidebar entry is hidden. The Blog has no route yet.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.volunteer": z.boolean().default(true).register(registry, {
    label: "Volunteer enabled",
    description:
      "When off, the Volunteer “coming soon” sidebar entry is hidden. Volunteer has no route yet.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.calendar": z.boolean().default(true).register(registry, {
    label: "Calendar enabled",
    description:
      "When off, the Calendar “coming soon” sidebar entry is hidden. Calendar has no route yet.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.forum": z.boolean().default(true).register(registry, {
    label: "Forum enabled",
    description:
      "When off, the Forum “coming soon” sidebar entry is hidden. Forum has no route yet.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.analytics": z.boolean().default(true).register(registry, {
    label: "Analytics enabled",
    description:
      "When off, the Analytics “coming soon” sidebar entry is hidden. Analytics has no route yet.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.reports": z.boolean().default(true).register(registry, {
    label: "Reports enabled",
    description:
      "When off, the Reports “coming soon” sidebar entry is hidden. Reports has no route yet.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),

  // Kill switch for the in-progress announcements feature. Unlike the
  // other page flags it defaults OFF (feature not yet launched) and also
  // gates the header bell + the server write actions (defense-in-depth in
  // announcements-actions.server.ts), not just page reachability. Lives in
  // the `pages` category so it toggles from the same screen as every other
  // page.
  "pages.announcements": z.boolean().default(false).register(registry, {
    label: "Announcements enabled",
    description:
      "Hides the announcement bell, sidebar entry, and /announcements route while off. Toggle on once the feature is ready.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-05-13",
    confirm:
      "Flipping this changes whether members see announcements at all. Existing announcement data and role grants stay in the database — toggling back on restores access.",
  }),

  // Home / landing page.
  "pages.home": z.boolean().default(true).register(registry, {
    label: "Home page enabled",
    description:
      "When off, the / landing page returns notFound. Auth, registration, and legal pages stay reachable regardless.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),

  // Members surfaces. The directory (`pages.members`) plus each officer
  // management tab and the member-detail page, individually toggleable.
  "pages.members": z.boolean().default(true).register(registry, {
    label: "Members directory enabled",
    description:
      "When off, the Members sidebar entry is hidden and the /members directory returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.members_pending": z.boolean().default(true).register(registry, {
    label: "Members · Pending tab enabled",
    description:
      "When off, the Pending tab is hidden and /members/pending returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.members_unclaimed": z.boolean().default(true).register(registry, {
    label: "Members · Unclaimed tab enabled",
    description:
      "When off, the Unclaimed tab is hidden and /members/unclaimed returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.members_rejected": z.boolean().default(true).register(registry, {
    label: "Members · Rejected tab enabled",
    description:
      "When off, the Rejected tab is hidden and /members/rejected returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.members_deactivated": z.boolean().default(true).register(registry, {
    label: "Members · Deactivated tab enabled",
    description:
      "When off, the Deactivated tab is hidden and /members/deactivated returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.members_detail": z.boolean().default(true).register(registry, {
    label: "Member detail page enabled",
    description:
      "When off, individual member profile pages (/members/$id) return notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.members_roles": z.boolean().default(true).register(registry, {
    label: "Members · Roles page enabled",
    description:
      "When off, the Roles sidebar sub-item is hidden and /members/roles returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.members_waivers": z.boolean().default(true).register(registry, {
    label: "Members · Waivers page enabled",
    description:
      "When off, the Waivers sidebar sub-item is hidden and /members/waivers returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),

  // Gear surfaces.
  "pages.gear": z.boolean().default(true).register(registry, {
    label: "Gear inventory enabled",
    description:
      "When off, the Gear sidebar entry is hidden and the /gear inventory returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.gear_detail": z.boolean().default(true).register(registry, {
    label: "Gear detail page enabled",
    description: "When off, individual gear pages (/gear/$id) return notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.gear_loans": z.boolean().default(true).register(registry, {
    label: "Gear loans desk enabled",
    description:
      "When off, the Loans sidebar sub-item is hidden and /gear/loans returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.gear_loans_detail": z.boolean().default(true).register(registry, {
    label: "Gear loan detail page enabled",
    description:
      "When off, individual loan pages (/gear/loans/$id) return notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),

  // Feedback surfaces. These gate page reachability; the separate
  // `feedback.*_enabled` flags gate whether new submissions are accepted.
  "pages.feedback": z.boolean().default(true).register(registry, {
    label: "Website feedback page enabled",
    description:
      "When off, the Feedback sidebar entry is hidden and /feedback returns notFound. Separate from the submission kill switch below.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.feedback_club": z.boolean().default(true).register(registry, {
    label: "Club feedback page enabled",
    description:
      "When off, the club-feedback tab is hidden and /feedback/club returns notFound. Separate from the submission kill switch below.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),

  // Personal / user-menu pages.
  "pages.my_account": z.boolean().default(true).register(registry, {
    label: "My Account · Profile enabled",
    description:
      "When off, the My Account link is hidden and /my/account returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.my_account_details": z.boolean().default(true).register(registry, {
    label: "My Account · Details tab enabled",
    description:
      "When off, the Details tab is hidden and /my/account/details returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.my_account_preferences": z.boolean().default(true).register(registry, {
    label: "My Account · Preferences tab enabled",
    description:
      "When off, the Preferences tab is hidden and /my/account/preferences returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.my_account_security": z.boolean().default(true).register(registry, {
    label: "My Account · Sign-in tab enabled",
    description:
      "When off, the Sign-in tab is hidden and /my/account/security returns notFound. Turning this off can strand members who manage passkeys here.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.my_account_waiver": z.boolean().default(true).register(registry, {
    label: "My Account · Waiver tab enabled",
    description:
      "When off, the Waiver tab is hidden and /my/account/waiver returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.my_gear": z.boolean().default(true).register(registry, {
    label: "My Gear enabled",
    description:
      "When off, the My Gear link is hidden and /my/gear returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),
  "pages.my_gear_cart": z.boolean().default(true).register(registry, {
    label: "My Gear · Cart enabled",
    description:
      "When off, the pre-checkout cart is hidden and /my/gear/cart returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),

  // Submission gates for the two feedback surfaces. Each flag controls
  // ONLY whether new submissions are accepted — managers always retain
  // access to the triage view of existing rows (gated separately by
  // `feedback:manage` / `club_feedback:manage`). Defaults are ON so a
  // fresh DB / new deploy keeps both forms open. Exposed publicly via
  // `getPublicFlagsFn` so the route guards and tab bar can decide
  // synchronously whether to render the submit UI for non-managers.
  "feedback.website_enabled": z.boolean().default(true).register(registry, {
    label: "Accept website feedback submissions",
    description:
      "When off, the website-feedback submit form and endpoint are disabled. Managers still see existing submissions in the triage view, and the GitHub mirror still fires for legacy in-flight rows.",
    category: "feedback",
    flagKind: "ops",
    owner: "system_admin",
    createdAt: "2026-05-16",
  }),
  "feedback.club_enabled": z.boolean().default(true).register(registry, {
    label: "Accept club feedback submissions",
    description:
      "When off, the club-feedback submit form and endpoint are disabled. Managers still see existing submissions in the triage view.",
    category: "feedback",
    flagKind: "ops",
    owner: "system_admin",
    createdAt: "2026-05-16",
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

// ── Page flags ──────────────────────────────────────────────────────────
//
// Every `pages.*` boolean is a per-page kill switch. The public-flags
// snapshot exposes them as a map keyed by the suffix after `pages.` so
// adding a page is one registry entry — the map, its type, the reader,
// and the client fallback are all derived, no per-page edits elsewhere.
export type PageSettingKey = Extract<SettingKey, `pages.${string}`>;
export type PageFlagKey = PageSettingKey extends `pages.${infer TSuffix}`
  ? TSuffix
  : never;

export const PAGE_SETTING_KEYS = SETTING_KEYS.filter(
  (key): key is PageSettingKey => key.startsWith("pages."),
);

/** Strip the `pages.` prefix to get the public-flags map key. */
export function pageFlagKeyOf(key: PageSettingKey): PageFlagKey {
  return key.slice("pages.".length) as PageFlagKey;
}

// ── Group keys by category for UI iteration ────────────────────────────
export function keysByCategory(): Record<SettingCategory, SettingKey[]> {
  const out: Record<SettingCategory, SettingKey[]> = {
    contact: [],
    pages: [],
    feedback: [],
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
