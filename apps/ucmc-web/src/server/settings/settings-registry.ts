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
// Categories double as section headings on /settings, and each one answers
// a different question:
//
//   contact  — values the site displays (email, social URLs).
//   pages    — *reachability*: is this page in the nav and does it resolve?
//              Uniform meaning across ~43 booleans, which is what lets the
//              route guards and the flags map be generic.
//   features — *behaviour*: does this feature accept writes / render its
//              affordances? These are NOT page flags. `announcements` lives
//              here (not in `pages`) because it also gates the header bell
//              and the server write actions, and the feedback switches live
//              here because they pause new submissions while deliberately
//              leaving the page reachable so managers can still triage.
//
// `integrations` / `appearance` / `legal` are reserved for cross-cutting
// concerns that don't belong to a single feature.
//
// Keep the meanings honest: a boolean that does more than hide-and-404 a
// page does not belong in `pages`, however page-shaped it looks.
export const SETTING_CATEGORIES = [
  "contact",
  "pages",
  "features",
  "integrations",
  "appearance",
  "legal",
] as const;
export type SettingCategory = (typeof SETTING_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SettingCategory, string> = {
  contact: "Contact",
  pages: "Pages",
  features: "Features",
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
  /**
   * For `pages.*` flags only: the flag key of the section this page
   * belongs to. A page is *effectively* on only when its own flag AND
   * every ancestor's are on — see `effectivePageFlags`.
   *
   * Declared, never inferred from the key name. The keys look
   * hierarchical but aren't: `pages.gear_cave` is the public `/gear-cave`
   * page, NOT a child of `pages.gear`, and `pages.members_detail` /
   * `pages.gear_loans_detail` name route params (`$publicId`) rather than
   * URL segments. Splitting on `_` would silently reparent all three.
   *
   * Typed as a plain string rather than `PageFlagKey`: that type is
   * derived from `SETTINGS`, whose entries are typed by this very
   * metadata, so naming it here is a circular reference (TS2502 /
   * TS2615). `pageParentOf()` is the narrowing accessor and validates
   * membership at runtime.
   */
  parent?: string;
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

// Shared shape for the social profile URLs below. An empty string is a
// meaningful value ("no account / hide the icon"), so this can't just be
// `z.string().url()` — that rejects "". The refine keeps the scheme
// explicit rather than accepting a bare "instagram.com/..." that would
// resolve as a same-origin relative path once dropped into an href.
const socialUrl = z
  .string()
  .trim()
  .max(300)
  .refine(
    (v) => v === "" || /^https:\/\//i.test(v),
    "Must start with https:// (or be left blank)",
  );

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

  // Social profile URLs. These were previously split across two homes —
  // Instagram lived in the landing CMS (`meeting.instagram_url`) while
  // Facebook and YouTube were hardcoded in the footer — so the same three
  // links could drift apart. They live here for the same reason
  // `contact.clubEmail` does: the footer and the landing "Where to find
  // us" block both render them, and neither is the owner.
  //
  // `socialUrl` allows the empty string as an explicit "we don't have
  // one / hide it" value; both surfaces skip a blank URL rather than
  // rendering a dead icon. Defaults are the club's live accounts (the
  // URLs the footer had been shipping), so a fresh DB is correct.
  "contact.instagramUrl": socialUrl
    .default("https://instagram.com/uc_mountaineering")
    .register(registry, {
      label: "Instagram URL",
      description:
        "Link behind the Instagram icon in the footer and in the landing page’s “Follow us” row. Leave blank to hide the icon.",
      category: "contact",
    }),

  "contact.facebookUrl": socialUrl
    .default("https://www.facebook.com/groups/19204046466/")
    .register(registry, {
      label: "Facebook URL",
      description:
        "Link behind the Facebook icon in the footer and in the landing page’s “Follow us” row. Leave blank to hide the icon.",
      category: "contact",
    }),

  "contact.youtubeUrl": socialUrl
    .default("https://www.youtube.com/channel/UC1zpNSpQI784F-zOtVHjUMQ")
    .register(registry, {
      label: "YouTube URL",
      description:
        "Link behind the YouTube icon in the footer and in the landing page’s “Follow us” row. Leave blank to hide the icon.",
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
  "pages.album": z.boolean().default(true).register(registry, {
    label: "Album enabled",
    description:
      "When off, the Album sidebar entry is hidden and the /album route returns notFound for everyone.",
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
  "pages.trips": z.boolean().default(true).register(registry, {
    label: "Trips enabled",
    description:
      "When off, the Trips “coming soon” sidebar entry is hidden. Trips has no route yet.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-22",
  }),
  "pages.elections": z.boolean().default(true).register(registry, {
    label: "Elections enabled",
    description:
      "When off, the Elections “coming soon” sidebar entry is hidden. Elections has no route yet.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-22",
  }),
  // One flag for the whole Executive section, not eight. Its seven
  // sub-items (Board, Meetings, Decisions, Goals, Tasks, Budget,
  // Handoff) aren't independently reachable — they're `aria-disabled`
  // placeholders inside the parent's Collapsible — so eight rows on
  // /settings would be noise for a section that doesn't exist yet. Split
  // them when the children become real routes, alongside the
  // `executive:read`-style permission the sidebar comment anticipates.
  "pages.executive": z.boolean().default(true).register(registry, {
    label: "Executive enabled",
    description:
      "When off, the Executive “coming soon” sidebar section and all of its sub-items are hidden. Executive has no routes yet.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-22",
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
  "pages.access": z.boolean().default(true).register(registry, {
    label: "Access page enabled",
    description:
      "When off, the Access sidebar entry is hidden and /access returns notFound. Role and permission delegation stays reachable by switching this back on from Settings.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
  }),

  // Members surfaces. `pages.members` is the SECTION — a grouping node
  // with no page of its own; switching it off takes the whole /members
  // area with it, because every child declares it as `parent` and the
  // effective value is the AND down the chain. The approved directory has
  // its own `pages.members_approved` flag so "hide the directory" and
  // "hide the whole members area" stay separable (they used to be the
  // same key, which meant switching off "Members" hid the directory while
  // leaving every officer queue reachable).
  "pages.members": z.boolean().default(true).register(registry, {
    label: "Members section enabled",
    description:
      "Master switch for the whole /members area. When off, the sidebar entry disappears and every page under /members returns notFound — including the officer tabs, regardless of their own switches.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-22",
    confirm:
      "This is the master switch for the entire Members area — the directory, every officer queue (Pending, Unclaimed, Rejected, Deactivated), member detail pages, and the waiver queue. Their individual switches keep their values and take effect again when this is switched back on.",
  }),
  "pages.members_approved": z.boolean().default(true).register(registry, {
    label: "Members · Approved directory enabled",
    description:
      "When off, the Approved tab is hidden and /members returns notFound. The officer tabs stay reachable — use the section switch above to take down the whole area.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "members",
  }),
  "pages.members_pending": z.boolean().default(true).register(registry, {
    label: "Members · Pending tab enabled",
    description:
      "When off, the Pending tab is hidden and /members/pending returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "members",
  }),
  "pages.members_unclaimed": z.boolean().default(true).register(registry, {
    label: "Members · Unclaimed tab enabled",
    description:
      "When off, the Unclaimed tab is hidden and /members/unclaimed returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "members",
  }),
  "pages.members_rejected": z.boolean().default(true).register(registry, {
    label: "Members · Rejected tab enabled",
    description:
      "When off, the Rejected tab is hidden and /members/rejected returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "members",
  }),
  "pages.members_deactivated": z.boolean().default(true).register(registry, {
    label: "Members · Deactivated tab enabled",
    description:
      "When off, the Deactivated tab is hidden and /members/deactivated returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "members",
  }),
  "pages.members_detail": z.boolean().default(true).register(registry, {
    label: "Member detail page enabled",
    description:
      "When off, individual member profile pages (/members/$id) return notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "members",
  }),
  "pages.members_waivers": z.boolean().default(true).register(registry, {
    label: "Members · Waivers page enabled",
    description:
      "When off, the Waivers sidebar sub-item is hidden and /members/waivers returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "members",
  }),

  // Gear surfaces.
  // `/gear` section. Like `members`, this is a grouping node with no page
  // of its own — the inventory list it used to gate now has its own
  // `pages.gear_inventory`. NOTE: `pages.gear_cave` is the separate public
  // `/gear-cave` page and is deliberately NOT a child of this.
  "pages.gear": z.boolean().default(true).register(registry, {
    label: "Gear section enabled",
    description:
      "Master switch for the whole /gear area. When off, the sidebar entry disappears and every page under /gear returns notFound, whatever the individual switches say. Does not affect the public Gear Cave page.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-22",
    confirm:
      "This is the master switch for the entire Gear area — the inventory list, item detail pages, and the loans desk. Individual switches keep their values and take effect again when this is switched back on.",
  }),
  "pages.gear_inventory": z.boolean().default(true).register(registry, {
    label: "Gear inventory enabled",
    description:
      "When off, the /gear inventory list returns notFound. Detail, loans, and the rest of the section stay reachable — use the section switch to take down all of /gear.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "gear",
  }),
  "pages.gear_detail": z.boolean().default(true).register(registry, {
    label: "Gear detail page enabled",
    description: "When off, individual gear pages (/gear/$id) return notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "gear",
  }),
  "pages.gear_loans": z.boolean().default(true).register(registry, {
    label: "Gear loans desk enabled",
    description:
      "When off, the Loans sidebar sub-item is hidden and /gear/loans returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "gear",
  }),
  "pages.gear_loans_detail": z.boolean().default(true).register(registry, {
    label: "Gear loan detail page enabled",
    description:
      "When off, individual loan pages (/gear/loans/$id) return notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "gear_loans",
  }),

  // Feedback surfaces. These gate page reachability; the separate
  // `feedback.*_enabled` flags gate whether new submissions are accepted.
  "pages.feedback": z.boolean().default(true).register(registry, {
    label: "Feedback section enabled",
    description:
      "Master switch for the whole /feedback area. When off, the sidebar entry disappears and both the website and club surfaces return notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-22",
    confirm:
      "This is the master switch for the entire Feedback area — both the website and club surfaces. Members will have no way to reach either form. Individual switches keep their values.",
  }),
  "pages.feedback_site": z.boolean().default(true).register(registry, {
    label: "Feedback · Site tab reachable",
    description:
      "When off, the Site tab is hidden and /feedback/site returns notFound. To stop new submissions while leaving the page open for managers to triage, use “Accept site feedback submissions” under Features instead.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "feedback",
  }),
  "pages.feedback_club": z.boolean().default(true).register(registry, {
    label: "Club feedback page reachable",
    description:
      "When off, the club-feedback tab is hidden and /feedback/club returns notFound. To stop new submissions while leaving the page open for managers to triage, use “Accept club feedback submissions” under Features instead.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "feedback",
  }),

  // `/my` section — every member's own account surface. Purely additive:
  // there was no `pages.my` before, so nothing is renamed here.
  //
  // The `confirm` is deliberately blunt. Unlike the other sections this one
  // gates *self-service*: with it off, members can't reach their own
  // profile, emergency contacts, waiver status, or passkeys, and the
  // waiver guard's redirect to /my/waiver 404s. That's a support incident,
  // not a feature toggle.
  "pages.my": z.boolean().default(true).register(registry, {
    label: "My Account section enabled",
    description:
      "Master switch for the whole /my area — every member's own profile, details, contacts, waiver, security, preferences, and gear. When off, all of them return notFound regardless of their individual switches.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-22",
    confirm:
      "This switches off EVERY member's own account area — profile, contact details, emergency contacts, waiver status, passkeys, and preferences. Members will have no way to view or correct their own data, and anyone sent to /my/waiver by the waiver guard will get a 404 instead. Only do this during a deliberate maintenance window.",
  }),
  // Personal / user-menu pages. Each is a tab on the `/my/_tabs`
  // account layout; `my_profile` additionally gates the user-menu link.
  "pages.my_profile": z.boolean().default(true).register(registry, {
    label: "My Account · Profile enabled",
    description:
      "When off, the My Account link is hidden and /my/profile returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "my",
  }),
  "pages.my_details": z.boolean().default(true).register(registry, {
    label: "My Account · Details tab enabled",
    description:
      "When off, the Details tab is hidden and /my/details returns notFound. Turning this off also hides the email-address manager, which lives on that tab.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "my",
  }),
  "pages.my_contacts": z.boolean().default(true).register(registry, {
    label: "My Account · Contacts tab enabled",
    description:
      "When off, the Contacts tab is hidden and /my/contacts returns notFound. Members can no longer edit their own emergency contacts while it is off.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "my",
  }),
  "pages.my_waiver": z.boolean().default(true).register(registry, {
    label: "My Account · Waiver tab enabled",
    description:
      "When off, the Waiver tab is hidden and /my/waiver returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "my",
  }),
  "pages.my_security": z.boolean().default(true).register(registry, {
    label: "My Account · Security tab enabled",
    description:
      "When off, the Security tab is hidden and /my/security returns notFound. Turning this off can strand members who manage passkeys here.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "my",
  }),
  "pages.my_preferences": z.boolean().default(true).register(registry, {
    label: "My Account · Preferences tab enabled",
    description:
      "When off, the Preferences tab is hidden and /my/preferences returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "my",
  }),
  "pages.my_gear": z.boolean().default(true).register(registry, {
    label: "My Gear enabled",
    description:
      "When off, the My Gear link is hidden and /my/gear returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "my",
  }),
  "pages.my_gear_cart": z.boolean().default(true).register(registry, {
    label: "My Gear · Cart enabled",
    description:
      "When off, the pre-checkout cart is hidden and /my/gear/cart returns notFound.",
    category: "pages",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-08-21",
    parent: "my_gear",
  }),

  // Submission gates for the two feedback surfaces. Each flag controls
  // ONLY whether new submissions are accepted — managers always retain
  // access to the triage view of existing rows (gated separately by
  // `feedback:manage` / `club_feedback:manage`). Defaults are ON so a
  // fresh DB / new deploy keeps both forms open. Exposed publicly via
  // `getPublicFlagsFn` so the route guards and tab bar can decide
  // synchronously whether to render the submit UI for non-managers.
  // Kill switch for the in-progress announcements feature. Defaults OFF
  // (not yet launched). This is a FEATURE flag, not a page flag: besides
  // hiding /announcements it also hides the header bell and rejects the
  // server write actions (defense-in-depth in
  // announcements-actions.server.ts). It lived in `pages` until the
  // `features` category existed, which made it look like every other
  // reachability switch — it never was one.
  "features.announcements": z.boolean().default(false).register(registry, {
    label: "Announcements enabled",
    description:
      "Hides the announcement bell, sidebar entry, and /announcements route while off. Toggle on once the feature is ready.",
    category: "features",
    flagKind: "release",
    owner: "system_admin",
    createdAt: "2026-05-13",
    confirm:
      "Flipping this changes whether members see announcements at all. Existing announcement data and role grants stay in the database — toggling back on restores access.",
  }),
  "feedback.site_enabled": z.boolean().default(true).register(registry, {
    label: "Accept site feedback submissions",
    description:
      "Pauses NEW site-feedback submissions: the form and the endpoint both refuse. The page stays reachable and managers keep triaging the backlog — that's the difference from the Site tab page switch under Pages, which 404s the page for everyone. The GitHub mirror still fires for legacy in-flight rows.",
    category: "features",
    flagKind: "ops",
    owner: "system_admin",
    createdAt: "2026-05-16",
  }),
  "feedback.club_enabled": z.boolean().default(true).register(registry, {
    label: "Accept club feedback submissions",
    description:
      "Pauses NEW club-feedback submissions: the form and the endpoint both refuse. The page stays reachable and managers keep triaging the backlog — that's the difference from the Club feedback page switch under Pages, which 404s the page for everyone.",
    category: "features",
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

/**
 * The declared section a page sits under, or null for a root page.
 *
 * Also the validation boundary for `SettingMeta.parent`, which is a bare
 * string for the circularity reason documented there: a value that isn't
 * an actual page key comes back as null, so a typo degrades to "root
 * page" rather than switching a live page off.
 */
export function pageParentOf(key: PageFlagKey): PageFlagKey | null {
  const declared = getMeta(`pages.${key}` as PageSettingKey).parent;
  if (!declared) {
    return null;
  }
  const asSettingKey = `pages.${declared}`;
  return PAGE_SETTING_KEYS.some((candidate) => candidate === asSettingKey)
    ? (declared as PageFlagKey)
    : null;
}

/**
 * Collapse raw page-flag values into *effective* ones: a page is on only
 * when its own switch AND every ancestor section's are on.
 *
 * This is the single place the cascade happens, and that's deliberate.
 * Every consumer — the sidebar, both tab bars, and every route guard —
 * already reads `flags.pages[key]`, so folding ancestry into that map
 * gives all of them cascade with no call-site changes, and no way for one
 * of them to forget.
 *
 * `/settings` must NOT use this: it edits and displays RAW values (via
 * `listSiteSettingsFn`). Showing a child as off because its parent is off
 * would be indistinguishable from the admin having switched the child
 * off, and re-enabling the parent would look like the child's setting had
 * been lost.
 *
 * A `parent` naming a key that isn't in the registry is treated as absent
 * rather than as "off" (see `pageParentOf`) — a typo shouldn't silently
 * 404 a live page.
 */
export function effectivePageFlags(
  raw: Record<PageFlagKey, boolean>,
): Record<PageFlagKey, boolean> {
  const out = {} as Record<PageFlagKey, boolean>;
  for (const key of PAGE_SETTING_KEYS) {
    const own = pageFlagKeyOf(key);
    out[own] =
      raw[own] && pageAncestorsOf(own).every((ancestor) => raw[ancestor]);
  }
  return out;
}

/**
 * The declared ancestors of a page flag, nearest first.
 *
 * The single implementation of the parent walk — every consumer that needs
 * ancestry (the cascade above, the `/settings` "inherited off" count) goes
 * through this rather than looping on `pageParentOf` itself, so the cycle
 * bound below can't be forgotten at one call site.
 *
 * The walk is bounded and cycle-guarded: `parent` is a plain string
 * validated only for registry membership, so nothing stops a future edit
 * from declaring `a → b → a`. A mis-declared cycle has to degrade to a
 * wrong answer, never to a hung request or a blown stack — and the page
 * that would hang is `/settings`, the one place the bad flag could be
 * fixed. `page-flag-cascade.test.ts` pins this.
 */
export function pageAncestorsOf(key: PageFlagKey): PageFlagKey[] {
  const chain: PageFlagKey[] = [];
  const seen = new Set<PageFlagKey>([key]);
  for (
    let ancestor = pageParentOf(key);
    ancestor && !seen.has(ancestor);
    ancestor = pageParentOf(ancestor)
  ) {
    chain.push(ancestor);
    seen.add(ancestor);
  }
  return chain;
}

// ── Group keys by category for UI iteration ────────────────────────────
export function keysByCategory(): Record<SettingCategory, SettingKey[]> {
  const out: Record<SettingCategory, SettingKey[]> = {
    contact: [],
    pages: [],
    features: [],
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
// Used by `updateSettingFn`'s `.validator(...)`. Auto-derived from
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
