---
paths:
  - "apps/ucmc-web/src/server/settings/**"
  - "apps/ucmc-web/src/features/settings/**"
  - "apps/ucmc-web/src/routes/settings.tsx"
---

# Site settings & page flags (`/settings`)

Runtime-editable platform configuration. Gated by `settings:manage` (auto-granted only to `system_admin` via the bypass in `principal.server.ts`; delegate to other roles at `/access`).

**Adding a new setting is one entry in `SETTINGS` — no migration, no new mutation hook, no new audit action.**

## Three kinds of setting, one per category, and the distinction is load-bearing

- **`contact.*`** — _values_ the site displays.
- **`pages.*`** — _reachability_ switches with one uniform meaning (hide from nav + `notFound()` for everyone). That uniformity is what lets the route guards and the flags map be generic.
- **`features.*`** — _behaviour_ switches that do more than hide a page.

**A boolean that does more than hide-and-404 a page does not belong in `pages`, however page-shaped it looks.** `announcements` lived there until migration `0062` and is the standing counter-example: it also hides the header bell and makes the server write actions refuse. The feedback submission switches (`feedback.site_enabled` / `feedback.club_enabled`) are `features` for the same reason and are **deliberately NOT merged into the page flags** — switching one off pauses new submissions while leaving the page reachable so managers keep triaging the backlog, whereas the page flag 404s the page for everyone including them. Each pair cross-references the other in its registry description.

Route guards mirror the split: `requirePageFlag` for `pages.*`, **`requireFeatureFlag`** for `features.*` (flat, no cascade, reads the snapshot's top-level fields).

## The registry is the single source of truth

`src/server/settings/settings-registry.ts`. Every setting declares its schema (`z.string()`, `z.boolean()`, `z.object({...})`, anything) and metadata (label, description, category, optional `flagKind` / `owner` / `expiresAt`) in one entry. The `SETTINGS` map drives types (`readSetting("the.key")` is type-narrowed), the discriminated update validator, the admin UI (auto-form by schema introspection, custom `editor` slot for freeform shapes), and the audit metadata branch (boolean values logged with value; non-boolean values logged with key only).

Storage is D1 (`site_settings`, `value_json TEXT` accepts any JSON shape) with **fail-open reads**: missing rows / parse errors / D1 throws all fall back to the schema default so the site keeps working on a fresh DB.

One audit action covers every change: `settings_updated`, with `targetType: "site_setting"` + `targetId: <key>`.

Keys ending in `Url` / `Email` get `<input type="url">` / `type="email"` for free via `inferInputType` in `setting-row.tsx` — **name new keys accordingly**.

## How a row is edited

**Booleans apply on change; everything else is click-to-edit.** A switch carries its own commit — you can see what you did and undo it in one tap — while a text value gets a pencil at rest, opening an `InputGroup` with tick/cross (Enter saves, Escape cancels, the same contract as `passkey-section`'s rename). That split is the shape of the page, not an inconsistency: every write is an audit event and several settings are live kill switches, so a text change earns a deliberate commit, but forty permanently-mounted inputs with forty Save buttons is what the page looked like before, and on a phone each row cost two stacked full-width blocks for an interaction that is overwhelmingly _reading_ a value.

**The editor closes on success, not on submit**, and that is the part a refactor breaks silently. A value rejected by the registry schema is exactly when the admin needs their text still on screen; the row behind the editor renders the canonical value, so closing would discard the edit and read as the row ignoring them. `useSettingSaver.requestSave` therefore resolves a **`SaveOutcome`** (`"saved" | "failed" | "confirming"`) rather than returning void. `"confirming"` is its own outcome because nothing has been written yet — the value is parked in `pending` and `SettingConfirmDialog` owns it from there, so a caller that closed on it would be guessing. `setting-row.test.tsx` pins both failure paths.

**Reset-to-default and edit-history ride with the row's control, not in a footer.** `RowActions` is the trailing element of the value row for a text setting and of the header row beside the switch for a boolean, which leaves the footer position holding nothing but `LastEditedLine` — and that returns null for a setting nobody has changed, so an untouched row has no footer at all. As an icons-only footer it was a whole extra row of dead space on most of the forty-odd cards.

**The cluster is the trailing element in both edit states on purpose.** Only the leading part of the value row swaps — value + pencil at rest, the editor and its own tick/cross while editing — so the flexible element absorbs the width change and reset/history stay exactly where the eye left them. A control that relocates when you start typing is worse than the row being a line taller. `setting-row.test.tsx` pins that they never unmount, which is the half a refactor is likely to break by moving them into a state-specific branch.

`persist` catches a rejected `mutateAsync` and sets `error`. Every caller reaches it through a `void`, so before that a dropped connection was an unhandled rejection and nothing on screen — the row simply appeared not to respond.

## The public subset

`getPublicSiteContactFn` is a curated allowlist in `settings-actions-read.server.ts` carrying `contact.clubEmail` plus the three social URLs, read by both the app footer and the landing page's "Where to find us" block. Both render through the shared presentational `<SocialIconLinks>` (`src/components/social-icon-links.tsx`), which takes plain URL strings rather than reading the query itself — that keeps it out of `src/features/` and lets a blank URL mean "no such account" (the icon is dropped; an `href=""` would resolve as a same-origin reload).

**Each public read is its own allowlisted payload, not extra fields bolted onto a neighbour.** `getPublicBrandingFn` (`appearance.headerTitle` / `headerTagline`) is a third public read alongside the contact and flags ones rather than two extra fields on the contact payload — that one is genuinely contact information, and widening it to carry chrome text would make the name a lie. Allowlisting in the action is also what stops reclassifying a setting into `appearance` from surfacing it publicly by accident. Every public key shares the `["site-settings"]` prefix, so one `useUpdateSetting` write invalidates all of them.

Static `config/site.ts` constants (`MAINTAINER_EMAIL`, `GITHUB_REPO_URL`) are intentionally NOT runtime-editable; they're maintainer-identifying and ~never change — which is also why the footer's GitHub icon stays hardcoded while the social icons beside it don't.

## Per-page kill switches

One `pages.<key>` boolean per reachable page, **universal across the sidebar**, including route-less "coming soon" placeholders whose flags only hide the sidebar entry. **Keep new placeholders flagged so "is it flagged?" never needs checking.**

They surface in the public-flags snapshot as a **generic map** `flags.pages[<key>]` (`getPublicFlagsFn` → `publicFlagsQueryOptions`), typed `Record<PageFlagKey, boolean>` where `PageFlagKey` derives from the `pages.*` registry keys. The map, its type, the server reader, and the client fallback are all built by iterating `PAGE_SETTING_KEYS`, so **adding a page flag is one `SETTINGS` entry**. See the `add-page-flag` skill for the guard wiring.

**Every `pages.*` default is ON.** Intentionally flag-less (always reachable): the **home/landing page** — it's the target of the header logo, sign-out, post-account-deletion, the permission-denied `redirect({ to: "/" })` in `requirePermission`, and the not-found/error pages' own "home" links, none of which consult the flag, so a disableable home would soft-brick every fallback; **Settings** (self-lockout hazard — it's where flags are managed), **Audit**, auth/registration plumbing, and the legal/compliance pages.

## Sections cascade

A `pages.*` entry may declare `parent: "<flag key>"` in its registry metadata, making it a child of a **section node** — a flag with no page of its own that acts as the master switch for an area. A page is _effectively_ on only when its own switch AND every ancestor's are on.

The cascade is applied in exactly one place, **`effectivePageFlags`** in `settings-registry.ts`, called where the flags map is built (`getPublicFlagsAction` and the `publicFlagsQueryOptions` fallback). Because every consumer — sidebar, both tab bars, every route guard — reads `flags.pages[<key>]`, folding ancestry into that map gives all of them cascade with **no call-site changes and no way for one to forget**.

**`/settings` is the deliberate exception**: it reads **raw** values via `listSiteSettingsFn`, because a child shown as off merely because its parent is off would be indistinguishable from the admin having switched the child off, and re-enabling the parent would look like the child's setting had been lost.

**`SettingMeta.parent` is typed `string`, not `PageFlagKey`**: that type derives from `SETTINGS`, whose entries are typed by this very metadata, so naming it there is a circular reference (TS2502 / TS2615). **`pageParentOf()` is the narrowing accessor** and validates membership at runtime, so a typo degrades to "root page" rather than switching a live page off.

**Parentage is declared, never inferred from the key name.** The keys only look hierarchical: `pages.gear_cave` is the public `/gear-cave` page and NOT a child of `pages.gear`, and `pages.members_detail` / `pages.gear_loans_detail` name route params rather than URL segments, so splitting on `_` would silently reparent all three. `page-flag-cascade.test.ts` pins that.

Four sections exist — `members`, `gear`, `feedback`, `my`. The first three each used to name an index page while reading like a section, so the index page kept its own key (`members_approved`, `gear_inventory`, `feedback_site`) and the bare key became the grouping node. Nesting goes as deep as the URLs: `gear_loans_detail` → `gear_loans` → `gear`. **`pages.my` deserves care** — it's the one section that gates member self-service, so switching it off stops every member reaching their own waiver, contacts, and passkeys; its `confirm` says so.

**A nav entry must be gated on the flag of the page its link actually targets, not on the section flag.** The sidebar's "Members" / "Gear" entries link to `/members` and `/gear`, so they read `members_approved` / `gear_inventory`. Effective flags mean the section still hides them, and this is what keeps the entry from linking to a page that 404s when only the index is switched off. Both sidebar entries had this wrong when the sections landed.

## The `pages` renderer

The `pages` category gets its own compact renderer, **`PageFlagsPanel`** — a single-column tree, deliberately not a grid, because a page's meaning comes from its position under its section and columns break that reading order. Sections collapse, nested sections collapse independently, and each row carries an info popover (a `HoverCard` on a real button, so it opens on focus too). It replaces the generic one-card-per-setting `SettingRow`: ~40 homogeneous booleans as 80px cards is several screens of scrolling.

A filter box narrows the tree, and because the section rows stay mounted across filter changes their `Collapsible` is **controlled** — `defaultOpen` is read once at mount, so a filtered-to match inside a collapsed section would never render. It's built by iterating `PAGE_SETTING_KEYS`, so a new flag needs no edit here. The write path (including the `meta.confirm` gate) is shared with `SettingRow` through **`useSettingSaver`** + **`SettingConfirmDialog`** — don't reimplement it in either; the confirm gate is a safety feature.
