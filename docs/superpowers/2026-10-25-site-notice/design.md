# Site notice

Status: approved design, 2026-10-25. Implementation plan to follow.

## Goals

1. **A one-line notice on every page.** Authorized exec post a short message ("ALL gear must be turned in before spring break trips") that renders as a sticky banner above page content.
2. **Configurable audience, tone and text.** The audience is the public or approved members only. The tone is a preset colour. The text is free, but capped.
3. **Accessible at any length and in any tone.** It is one line on every screen width, scrolling as a ticker when the text overflows. Every tone clears AA contrast in both themes, and a test enforces that.
4. **Editable without the rest of `/settings`.** A new `notice:manage` permission lets a role edit the notice and nothing else.

## Decisions

| Question                                         | Decision                                                                                                                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage                                          | **Site settings**, four registry entries in a new `notice` category. No table. Settings already bring fail-open reads, audit, history and reset-to-default                                                                         |
| How many notices                                 | One at a time                                                                                                                                                                                                                      |
| Expiry or scheduling                             | **None. Manual on/off only.** An optional "show until" date and start/end scheduling were both considered and declined                                                                                                             |
| Who can edit                                     | A new **`notice:manage`** permission (one migration). Not `anonymous_grantable`. `system_admin` gets it through the existing bypass; exec roles are granted it at `/access`                                                        |
| Where it is edited                               | **`/settings`**, which admits holders of `settings:manage` **or** `notice:manage` and shows only the categories the viewer can edit. A dedicated `/notice` page, a header megaphone button and an avatar-menu dialog were rejected |
| How `/settings` learns about a second permission | An optional **`permission`** field on `SettingMeta`, defaulting to `settings:manage`. Every check (update, list, history, page guard, sidebar entry) asks the registry instead of hard-coding `settings:manage`                    |
| "Members only" means                             | **Approved members.** A signed-in account still pending approval does not see a members notice                                                                                                                                     |
| Where members-only is enforced                   | **On the server.** `getSiteNoticeFn` returns `null` to anyone outside the audience, so the text never reaches their browser                                                                                                        |
| Colour                                           | A closed set of **tones** (`info`, `success`, `warning`, `danger`, `neutral`), each a background/foreground token pair defined for light and dark. Never a free colour                                                             |
| Contrast bar                                     | **≥ 4.5:1** for every tone in both themes (it is small body text), asserted by a test that parses `styles.css`                                                                                                                     |
| Placement                                        | Inside `SidebarInset`, directly above `<main>`, `sticky top-(--header-height) z-20`. Never under the header or beside the sidebar                                                                                                  |
| Overflow                                         | One line. When the text is wider than the bar, a seamless horizontal marquee, moving at a speed set by length                                                                                                                      |
| Pausing the marquee (WCAG 2.2.2)                 | Pauses on hover and while focus is inside the bar, and has a pause/play button at the trailing edge                                                                                                                                |
| `prefers-reduced-motion`                         | No animation, and the text **wraps onto extra lines**. Truncating would hide part of the notice from the people who can't use the moving version                                                                                   |
| Dismissal                                        | **Not dismissible.** Not requested, and a dismissed notice would need per-viewer state                                                                                                                                             |

## Settings

New category `notice` (label "Notice") in `SETTING_CATEGORIES` / `CATEGORY_LABELS`.

| Key               | Schema                                                        | Default     | `permission`    |
| ----------------- | ------------------------------------------------------------- | ----------- | --------------- |
| `notice.enabled`  | `z.boolean()`                                                 | `false`     | `notice:manage` |
| `notice.text`     | `z.string().trim().max(200)`                                  | `""`        | `notice:manage` |
| `notice.audience` | `z.enum(["public", "members"])`                               | `"members"` | `notice:manage` |
| `notice.tone`     | `z.enum(["info", "success", "warning", "danger", "neutral"])` | `"info"`    | `notice:manage` |

The value is called `tone` rather than `color` because what is stored is a meaning that maps to a token pair, not a colour. The 200-character cap is there because past that the text stops being a one-liner, even though the marquee could scroll it.

`audience` defaults to `members` so that a notice someone enables without looking at the audience reaches the smaller group.

## Per-key setting permissions

`SettingMeta.permission?: Permission`. `settingPermissionOf(key)` returns it, defaulting to `"settings:manage"`. Every place that hard-codes `settings:manage` for settings moves to that accessor:

- **`updateSettingAction`** checks the permission of the key being written. A `notice:manage`-only caller who posts a `pages.*` update directly to the server function gets the same `Forbidden` error a caller with no permissions gets.
- **`listSiteSettingsAction`** requires at least one settings permission and returns only the keys the caller can edit.
- **`listSettingHistoryAction`** checks the permission of the requested key.
- **`/settings` `beforeLoad`** requires `settings:manage` **or** `notice:manage`. The set of permissions that can open the page is derived from the registry (every distinct `permission` plus the default), so the next per-key permission needs no guard edit.
- **The sidebar's Settings entry** uses `hasAnyPermission` over the same set. It stays a client gate through `hasPermission` / `hasAnyPermission`, so role emulation is respected.
- **The settings page** renders a category only when the viewer can edit at least one of its keys. The stale-review tray renders only for `settings:manage`.

`requireSettingsManage` in `features/settings/server/permissions.server.ts` becomes a per-key helper, e.g. `requireSettingPermission(principal, key)` and `requireAnySettingPermission(principal)`.

The `settings:manage` check in `features/analytics/server/platform-actions.server.ts` is a different surface and is left alone.

## Enum settings in the admin UI

- `autoFormType` adds `"enum"` for a `ZodEnum` (after `unwrapDefault`) and exposes the options.
- `SettingRow` renders `"enum"` as a `Select` that **applies on change**, the same contract as a boolean switch: the control carries its own commit and undoing it is one more pick. It uses `useSettingSaver`, so the `meta.confirm` gate still applies. `RowActions` (reset, history) stays the trailing element, as for a boolean.
- **Audit metadata** logs the value for enum settings as it already does for booleans. Neither is sensitive, and "who switched the audience to public" is the question the history dialog should answer. Strings stay key-only. The history entry gains an `enumValue` alongside `booleanValue`.
- `auto-form-type.test.ts`'s "every setting is renderable" assertion now covers the enum branch.

## Reading the notice

```ts
type SiteNotice = { text: string; tone: NoticeTone };
getSiteNoticeFn(): Promise<SiteNotice | null>
```

`getSiteNoticeAction` reads the four settings (fail-open, like every other read) and returns `null` when:

- `notice.enabled` is false, or
- `notice.text` is blank after trimming, or
- `notice.audience` is `"members"` and the caller is not an approved member. Approval is checked the way `requireApproved` checks it, against the real principal.

Like the other public reads, it is an allowlisted payload of its own, not fields added to `getPublicBrandingFn`.

**Query key.** `["site-settings", "notice", <viewer key>]`, where the viewer key distinguishes anonymous, signed-in-unapproved and approved. That way signing in, signing out or being approved re-fetches it rather than serving the previous audience's answer. Sharing the `["site-settings"]` prefix means `useUpdateSetting` invalidates it on every save, so an editor sees their change immediately.

**Role emulation.** Like other server payloads, the server answers for the real principal, and emulating a lower role does not hide a members notice. This matches the documented behaviour in `auth/emulation.md` and is acceptable for a banner.

## The banner

`src/components/layouts/site-notice-banner.tsx` (shell chrome, hence `components/layouts/`, not a feature). It has two parts:

- **`SiteNoticeBar`**, presentational. It takes `{ text, tone }` and is used by both the shell and the `/settings` preview.
- **`SiteNoticeBanner`**, which reads the query and renders `SiteNoticeBar` or nothing.

**Placement.** In `app-layout.tsx`, inside `SidebarInset`, before `<main>`:

```
<SidebarInset>
  <SiteNoticeBanner />      ← sticky top-(--header-height) z-20
  <main id="main">…</main>
  <AppFooter />
</SidebarInset>
```

It has a fixed height (about 36px) and stays in normal flow, so it pushes content down rather than covering it. Because it sits in the content column, it never spans the header or the sidebar. On a phone, where the sidebar is a sheet, it spans the full width under the header.

**Markup.** `<aside aria-label="Site notice">` containing the text, coloured with `bg-notice-<tone> text-notice-<tone>-foreground`. It has **no border**: the chrome rule says a coloured bar separates by colour.

**Marquee:**

1. The server render and first client render show the text on one line with `truncate`, so there is no hydration mismatch.
2. After mount, a `ResizeObserver` on the bar compares the text's `scrollWidth` with the available width. If the text fits, it stays static.
3. If it overflows, the bar switches to marquee mode. The text renders twice, separated by a gap, with the second copy `aria-hidden`. A CSS keyframe translates the strip from `0` to `-50%` in an infinite linear loop, so the end of the text flows straight into its own start. The duration is `strip width ÷ ~60px/s`, so every notice moves at the same reading speed.
4. The animation pauses (`animation-play-state: paused`) on hover, while focus is inside the bar, and when the **pause/play button** is toggled. The button exists only in marquee mode, sits at the trailing edge with an `aria-label` that names its action, and uses `aria-pressed`.
5. Under `prefers-reduced-motion: reduce`, marquee mode never engages. The text drops `truncate` and wraps. The pause button is not rendered.

**Focus ring.** The pause button's focus indicator uses the tone's **foreground** colour (`outline-notice-<tone>-foreground`), not `--ring`. The brand-green ring can fall under 3:1 against the `success` bar. The foreground is already guaranteed ≥ 4.5:1 against that background.

## Tone tokens and the contrast gate

`styles.css` gains `--notice-<tone>` and `--notice-<tone>-foreground` for the five tones in `:root` and `.dark`, written in oklch like the rest of the file, and mapped into Tailwind's `@theme` as `--color-notice-<tone>` / `--color-notice-<tone>-foreground`.

`notice-contrast.test.ts` reads `styles.css`, extracts each pair from both theme blocks, and converts oklch to OKLab to linear sRGB, clamped to gamut. It then computes WCAG relative luminance and asserts **≥ 4.5:1** for all ten pairs. The conversion is written in the test, about 30 lines; no colour library is added. The test also asserts that every tone in the `notice.tone` enum has both tokens in both themes, so adding a tone without its colours fails.

## Editor on `/settings`

`NoticePanel` is the renderer for the `notice` category, wired the way `pages` renders `PageFlagsPanel`. From top to bottom:

1. **Preview.** `SiteNoticeBar` fed the panel's current values. It shows the bar even while the notice is disabled, labelled "Preview (not live)", so an editor can try tones before switching it on. It also gets a caption naming the audience ("Visible to: approved members").
2. Four ordinary `SettingRow`s: enabled, text, audience, tone. The tone select shows a swatch beside each option.

All writes go through `useSettingSaver` / `useUpdateSetting`. There is no new mutation hook, audit action or server function.

## Testing

| Layer                           | What it pins                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry                        | `settingPermissionOf` defaults to `settings:manage`, and the `notice.*` keys return `notice:manage`. The set of permissions that can open `/settings` is derived from the registry                                                                                                                                                |
| Settings actions                | A `notice:manage`-only principal can update `notice.*` and is rejected on `pages.*` and `contact.*`. The list returns only editable keys. History is gated per key. Enum values are recorded in audit metadata and strings are not                                                                                                |
| `getSiteNoticeAction`           | `null` when disabled, blank or whitespace. A `members` notice is `null` for anonymous and pending users and present for approved members. A `public` notice is present for all three                                                                                                                                              |
| Contrast                        | Every tone is ≥ 4.5:1 in light and dark, and every enum tone has both tokens in both themes                                                                                                                                                                                                                                       |
| `SiteNoticeBar` (jsdom)         | The `aside` landmark name. Static and truncated when the text fits. When it overflows (stubbed `ResizeObserver` / widths): a duplicated strip, an `aria-hidden` second copy, and a pause button that toggles `aria-pressed` and the play state. Under reduced motion (stubbed `matchMedia`): no marquee, no button, wrapping text |
| `SettingRow` / `auto-form-type` | `z.enum` maps to `"enum"`. The row renders a select, saves on change, and keeps `RowActions` mounted                                                                                                                                                                                                                              |
| `NoticePanel`                   | The preview tracks the current values and is labelled when the notice is disabled                                                                                                                                                                                                                                                 |
| `/settings` and sidebar         | The guard and the Settings nav entry admit either permission. A `notice:manage`-only viewer sees only the Notice category and no stale tray                                                                                                                                                                                       |

Plus `pnpm verify` (lint, typecheck, knip, `db:drift`, test).

## Migration

One custom migration through `pnpm --filter ucmc-web db:generate --custom --name add_notice_manage_permission`. It inserts the `notice:manage` permission row (not `anonymous_grantable`) and only adds. No role is granted it automatically beyond the `system_admin` bypass.

## Commits

**One PR**, with four commits that are each green and independently revertable:

1. **Per-key setting permissions and the `notice:manage` permission.** The registry field and accessor, the actions, the `/settings` guard and the sidebar gate move to it, plus the migration. No visible change: every existing key still resolves to `settings:manage`.
2. **Enum settings in the admin UI.** `autoFormType`, `SettingRow` and audit metadata. No registry entry uses an enum yet, so it is tested with a fixture schema.
3. **The site notice.** Registry entries and category, `getSiteNoticeFn` and its query, tone tokens and the contrast test, `SiteNoticeBar` / `SiteNoticeBanner` in the shell, and `NoticePanel`.
4. **Docs.**
   - `.claude/rules/site-settings.md`: per-key `permission`, enum rendering, the `notice` category, and the notice as a fourth public read.
   - `.claude/rules/app-chrome.md`: the banner's placement and z-order, the reduced-motion wrap, and why its focus ring uses the tone foreground.
   - The auth rule's permission list: `notice:manage`.

## Out of scope

- Multiple concurrent notices, expiry, or scheduling.
- Per-viewer dismissal.
- Links or rich text in the notice.
- Letting role emulation hide a members notice.
