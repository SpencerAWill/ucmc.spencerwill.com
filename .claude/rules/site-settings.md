---
paths:
  - "apps/ucmc-web/src/server/settings/**"
  - "apps/ucmc-web/src/features/settings/**"
  - "apps/ucmc-web/src/routes/settings.tsx"
---

# Site settings & page flags (`/settings`)

Why settings are a code registry while permissions are rows: `docs/adr/0010-registries-not-rows.md`. This file is the rules for changing settings, flags and the `/settings` page.

## Where things go

- **`src/server/settings/settings-registry.ts`** is the single source of truth. Each `SETTINGS` entry declares a Zod schema and metadata (label, description, category, optional `flagKind` / `owner` / `expiresAt` / `permission` / `optionLabels` / `parent` / `confirm`, and a reserved `editor`). It drives the types (`readSetting("the.key")` is narrowed), the update validator, the admin UI (auto-form by schema introspection) and the audit metadata.
- **Storage**: `site_settings` (`value_json TEXT`), with **fail-open reads**: a missing row, a parse error or a D1 throw falls back to the schema default.
- **Audit**: one action, `settings_updated`, `targetType: "site_setting"`, `targetId: <key>`. Booleans and enums are logged with their value (`isEnumSetting`); everything else with the key only.
- **Permissions**: each key edits with `settingPermissionOf(key)` (its `permission`, else `settings:manage`). `notice.*` carries `notice:manage` (`0090`). Both are auto-granted only to `system_admin` (`principal.server.ts`); delegate at `/access`. The page admits anyone holding one of `SETTINGS_PAGE_PERMISSIONS`; `canEditSetting` is the shared predicate.
- **Public reads**, each its own allowlisted payload under the `["site-settings"]` query prefix: `getPublicSiteContactFn` (club email + three social URLs, rendered through `<SocialIconLinks>`), `getPublicFlagsFn`, `getPublicBrandingFn` (`appearance.headerTitle` / `headerTagline`), and `getSiteNoticeFn`.
- **`resolveSiteNotice`** (pure, `site-notice.ts`, in Stryker's `mutate` list) decides who sees the notice; queried per `NoticeViewer` (`siteNoticeQueryKey(viewer)`), prefetched by the root loader after the session, no `placeholderData`.
- **`effectivePageFlags`** applies the section cascade, in exactly one place. `pageParentOf()` is the narrowing accessor for `SettingMeta.parent`.
- **Renderers**: `SettingRow` (generic), `PageFlagsPanel` (the `pages` tree), `NoticePanel` (the `notice` rows under a live `SiteNoticeBar` preview). All writes go through `useSettingSaver` + `SettingConfirmDialog`.
- **Static, not settings**: `config/site.ts` (`MAINTAINER_EMAIL`, `GITHUB_REPO_URL`), maintainer-identifying and ~never changing.

## Rules that are easy to break

**Kinds of setting**

- **`contact.*` are values, `pages.*` reachability switches, `features.*` behaviour switches**, and the distinction is load-bearing. Every `pages.*` flag means exactly "hide from nav + `notFound()` for everyone".
- **A boolean that does more than hide-and-404 a page is not a `pages` flag.** The feedback submission switches (`site_feedback.submissions_enabled` / `club_feedback.submissions_enabled`) stay separate from their page flags: off pauses submissions while managers keep triaging. Each pair cross-references the other in its description.
- **There is no `features.*` route guard.** Enforce a behaviour flag where the behaviour lives; re-add a flat guard reading the snapshot only if one must 404 a route.

**Values and the editor**

- **Every setting is a scalar.** `SettingRow` has no `"unknown"` branch: an array or object renders as `"1,3"` and is written back as a string. A non-scalar needs the reserved `editor` slot built first; `auto-form-type.test.ts` asserts every entry is renderable. A `.refine()` is fine (it stays a `ZodString` to `unwrapDefault`). `gear.caveOpenDays` stayed a string (`"Mon,Wed"`, `parseWeekdayList`) rather than be the first non-scalar.
- **Name keys ending `Url` / `Email`** to get `type="url"` / `type="email"` from `inferInputType`.
- **Booleans and enums apply on change, optimistically**; a failed write restores the canonical value. Behind `confirm`, an enum goes through `requestSave` and shows the canonical value until the dialog commits.
- **Everything else is click-to-edit** (pencil → `InputGroup` with tick/cross; Enter saves, Escape cancels).
- **The editor closes on success, not on submit.** `requestSave` resolves a `SaveOutcome` (`"saved" | "failed" | "confirming"`); a rejected value must stay on screen. `setting-row.test.tsx` pins both failure paths.
- **Reset and history (`RowActions`) are the trailing element of the value row in both edit states** and never unmount; only the leading part swaps. The footer holds only `LastEditedLine`, which renders nothing for an untouched setting.
- **`persist` catches a rejected `mutateAsync` and sets `error`**; callers reach it through `void`.
- **Every surface answers per key**: `updateSettingAction` and `listSettingHistoryAction` check the key they touch (`requireSettingPermission`), `listSiteSettingsAction` returns only editable keys (so `SiteSettingsSnapshot` is `Partial`), and `SettingsCategories` renders only categories the viewer can edit, reading `hasPermission` so a role preview applies.
- **A setting's `permission` is a plain string**; `permission-catalog.test.ts` asserts each name exists.

**Public subset**

- **Each public read is its own allowlist in its action.** Never widen one payload to carry unrelated keys, and never let a category change publish a key by accident.
- **Every public key shares the `["site-settings"]` prefix**, so one `useUpdateSetting` write invalidates all of them; keep new public reads under it.
- **A blank social URL means "no such account"**: drop the icon, never `href=""`.
- **The notice is resolved in the Worker**: members-only text never reaches a signed-out browser, not even in the dehydrated cache.

**Page flags**

- **One `pages.<key>` per reachable page, default ON**, including route-less "coming soon" sidebar placeholders.
- **No flag (always reachable)** for home (every fallback redirects there), `/settings` (self-lockout), Audit, auth/registration plumbing, and legal/compliance pages.
- **Four sections exist: `members`, `gear`, `feedback`, `my`.** A section key is a grouping node with no page; the index page has its own key (`members_approved`, `gear_inventory`, `feedback_site`). Nesting follows the URLs (`gear_loans_detail` → `gear_loans` → `gear`).
- **Parentage is declared, never inferred from the key name** (`pages.gear_cave` is not a child of `pages.gear`). `page-flag-cascade.test.ts` pins it.
- **`SettingMeta.parent` stays typed `string`** (naming `PageFlagKey` there is circular, TS2502/TS2615); a typo degrades to "root page" via `pageParentOf()`.
- **Every consumer reads `flags.pages[<key>]`**, which already holds effective values. **`/settings` alone reads raw values** (`listSiteSettingsFn`), so a child off only because of its parent doesn't look switched off.
- **A nav entry gates on the flag of the page its link targets**, not the section's (`members_approved`, `gear_inventory`).
- **`pages.my` gates all member self-service** (waiver, contacts, passkeys); keep its `confirm` saying so.
- **`PageFlagsPanel` is a single-column tree, not a grid.** Each row's info popover is a `HoverCard` on a real button (opens on focus). Its section `Collapsible`s are **controlled**, so a filtered match inside a collapsed section renders.
- **Never reimplement the write path or the `confirm` gate** in a renderer; use `useSettingSaver` + `SettingConfirmDialog`.
- **`NoticePanel` previews the raw settings**, not `resolveSiteNotice`, with a "Visible to:" caption; blank text shows a prompt. Bar tones, ticker and placement: `app-chrome.md`.

## Adding things

- **A setting** is one `SETTINGS` entry: no migration, no mutation hook, no audit action.
- **A page flag** is one `pages.*` entry (`parent` if it's in a section); the map, its type, the reader and the client fallback iterate `PAGE_SETTING_KEYS`. Wire the guard and nav with the `add-page-flag` skill.
- **A permission-scoped category** is `permission` on its entries plus that permission's migration; nothing on the page or in the actions changes.
- **A public key** is added to the relevant allowlisted read (or a new read), never by reclassifying it.
- **Renaming a key** follows the `rename-permission-or-setting` skill.
