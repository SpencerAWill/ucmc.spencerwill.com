# Site Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-line, sticky site notice, edited on `/settings` by holders of a new `notice:manage` permission, shown either to the public or to approved members only, in a preset tone that always clears AA contrast.

**Architecture:** Four `notice.*` site settings, plus a per-key `permission` field on `SettingMeta` so `/settings` can admit a second permission. A pure module decides who sees what (`resolveSiteNotice`). An allowlisted public read applies it on the server, and the root loader prefetches it. `SiteNoticeBar` (presentational) and `SiteNoticeBanner` (query-bound) live in `components/layouts/` and mount inside `SidebarInset` above `<main>`. `NoticePanel` renders the category on `/settings` with a live preview.

**Tech Stack:** TanStack Start / Router / Query, React 19, Zod 4, Drizzle on D1, Tailwind v4, shadcn `Select`, Vitest (workers + dom pools).

**Spec:** `docs/superpowers/2026-10-25-site-notice/design.md`

## Global Constraints

- Branch `feat/site-notice`, **one PR**. Each commit is green and independently revertable. The spec's four commits are refined to six below; the PR is still one.
- Conventional Commits, scope `ucmc-web`, except docs-only commits touching `.claude/` (scope `global`). End each message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Setting keys and schemas, verbatim:
  - `notice.enabled`: `z.boolean().default(false)`
  - `notice.text`: `z.string().trim().max(200).default("")`
  - `notice.audience`: `z.enum(["public","members"]).default("members")`
  - `notice.tone`: `z.enum(["info","success","warning","danger","neutral"]).default("info")`
- New category `notice`, labelled "Notice".
- The permission is named `notice:manage` with id `perm_notice_manage`. It is not `anonymous_grantable`, and the migration seeds no grants.
- "Members" means `principal.status === "approved"`. Every other signed-in status counts as not a member.
- Contrast floor is **4.5:1** for every tone, in light and dark.
- Marquee speed is **60 px/s**. The banner is about 36px tall (`h-9`) when on one line, positioned `sticky top-(--header-height) z-20`.
- `const` only, braced control flow, no `inArray`, and `Temporal` for any time (none is needed here).
- Every migration goes through `pnpm --filter ucmc-web db:generate --custom --name <name>`. Never hand-write the journal.
- Run commands from the repo root as `pnpm --filter ucmc-web exec vitest run <path relative to apps/ucmc-web>`.

## Review Focus

1. **A members notice reaching a signed-out browser.** The SSR payload and the dehydrated query cache must not contain the text. Covered: Task 3 asserts that `getSiteNoticeAction` returns `null` for anonymous and pending callers, and that the root loader keys the prefetch by viewer.
2. **A `notice:manage`-only principal writing any other setting** through the server function directly. Covered: Task 1 tests a `pages.*` and a `contact.*` write being rejected.
3. **Text that is exactly the width of the bar, or that resizes across the threshold** (rotating a phone). The marquee must engage and disengage when the width changes, not only at mount. Covered: Task 4 drives a `ResizeObserver` callback twice, overflow then fit.
4. **Whitespace-only text with `enabled` on.** It must render nothing, not an empty coloured bar. Covered: Task 3's `resolveSiteNotice` table.
5. **Signing in or out without a reload.** The banner must re-key, not keep showing the previous audience's answer. Covered: Task 3 asserts `siteNoticeQueryOptions` keys differ per viewer, and Task 4 asserts the banner reads the viewer from `useAuth`.

---

### Task 1: Per-key setting permissions and the `notice:manage` permission

**Files:**

- Modify: `apps/ucmc-web/src/server/settings/settings-registry.ts` (add `permission?: string` to `SettingMeta`, `settingPermissionOf`, `SETTINGS_PAGE_PERMISSIONS`)
- Modify: `apps/ucmc-web/src/features/settings/server/permissions.server.ts` (replace `requireSettingsManager`)
- Modify: `apps/ucmc-web/src/features/settings/server/settings-actions.server.ts`
- Modify: `apps/ucmc-web/src/features/settings/server/settings-actions-read.server.ts` (list and history)
- Modify: `apps/ucmc-web/src/server/settings/settings-repo.server.ts` / `settings-fns.ts` (`SiteSettingsSnapshot` becomes `Partial<SiteSettingsEntries>`; fix call sites)
- Modify: `apps/ucmc-web/src/routes/settings.tsx` (guard), `apps/ucmc-web/src/components/layouts/app-layout.tsx:687` (sidebar gate)
- Create: migration via `db:generate --custom --name add_notice_manage_permission`
- Test: `apps/ucmc-web/src/features/settings/server/__tests__/settings-actions.test.ts`, `apps/ucmc-web/src/server/auth/__tests__/permission-catalog.test.ts`, `apps/ucmc-web/src/features/settings/server/__tests__/setting-permissions.test.ts` (new)

**Interfaces:**

- Produces:
  - `settingPermissionOf(key: SettingKey): string`, which returns `SETTINGS` meta `permission ?? "settings:manage"`.
  - `SETTINGS_PAGE_PERMISSIONS: readonly string[]`, the distinct `settingPermissionOf` over every key, with `"settings:manage"` first.
  - `requireSettingPermission(key: SettingKey): Promise<Principal>` throws `"Not signed in"` or `` `Forbidden: missing ${permission}` ``.
  - `requireAnySettingPermission(): Promise<Principal>` throws `"Not signed in"` or `"Forbidden: missing settings:manage"` (the existing message, so current tests keep passing).
  - `canEditSetting(permissions: readonly string[], key: SettingKey): boolean`.

- [ ] **Step 1: Write failing tests.** In `setting-permissions.test.ts`:
  - `settingPermissionOf("contact.clubEmail")` is `"settings:manage"`.
  - `SETTINGS_PAGE_PERMISSIONS` equals `["settings:manage"]`. That's correct today; Task 2 extends it.

  In `settings-actions.test.ts`, add `signInWithPermissionOnly(name)`, which seeds a role row plus a `role_permissions` grant for a permission looked up by name, assigns it, and signs in. Then add `describe("per-key permissions")`, using `notice:manage` as the only grant:
  - `updateSettingAction({ key: "pages.calendar", value: false })` rejects with `"Forbidden: missing settings:manage"`.
  - `updateSettingAction({ key: "contact.clubEmail", value: "x@example.com" })` rejects with the same error.
  - `listSiteSettingsAction()` resolves to an object with **no** keys. No `notice.*` keys exist until Task 2, which tightens this to exactly the four.

  In `permission-catalog.test.ts`:
  - `perm_notice_manage` has name `notice:manage` and `anonymous_grantable` false.
  - No `role_permissions` row references it.

- [ ] **Step 2: Run and confirm failure.**
      `pnpm --filter ucmc-web exec vitest run src/features/settings/server/__tests__ src/server/auth/__tests__/permission-catalog.test.ts`
      Expected: FAIL. The functions are undefined, the `notice:manage` permission row is missing, and the list currently throws for a non-manager.

- [ ] **Step 3: Write the migration.** Run `pnpm --filter ucmc-web db:generate --custom --name add_notice_manage_permission`. Fill the generated file with a header comment in the style of `0080_analytics_permission.sql` (why a separate permission, no seeded grants, `system_admin` via bypass) and:

  ```sql
  INSERT OR IGNORE INTO permissions (id, name, description) VALUES
    ('perm_notice_manage',
     'notice:manage',
     'Edit the site notice banner (text, audience, tone, on/off) on /settings. Grants no other setting.');
  ```

- [ ] **Step 4: Implement the registry accessors and permission helpers.**
  - `canEditSetting` is a pure function in the registry, so the server and the client share it.
  - `updateSettingAction` validates the key first, then calls `requireSettingPermission(key)`. For an unknown key, keep the existing order and behaviour: authenticate with `requireAnySettingPermission()` first, then return `unknown_key`.
  - `listSiteSettingsAction` calls `requireAnySettingPermission()`, then filters `readAllSettings()` to `canEditSetting(principal.permissions, key)`.
  - `listSettingHistoryAction` calls `requireSettingPermission(input.key)` once the key is known valid.
  - Server checks stay on `principal.permissions`, as they do today; the server answers for the real principal.

- [ ] **Step 5: Gate the route and the sidebar entry.**
  - `routes/settings.tsx` `beforeLoad` becomes `requireAnyPermission({ context, location }, SETTINGS_PAGE_PERMISSIONS)`.
  - `app-layout.tsx` sets `canManageSettings = hasAnyPermission(SETTINGS_PAGE_PERMISSIONS)`.
  - Fix any `SiteSettingsSnapshot` consumers that now see `Partial`. They already read `entries?.[key]`.

- [ ] **Step 6: Run the tests, then the drift check.**
      `pnpm --filter ucmc-web exec vitest run src/features/settings src/server/auth/__tests__/permission-catalog.test.ts` should PASS, including every pre-existing settings test.
      `pnpm --filter ucmc-web db:drift` should be clean.

- [ ] **Step 7: Commit** as `feat(ucmc-web): per-key permissions for site settings, and notice:manage`.

---

### Task 2: Notice settings and enum rendering in `/settings`

**Files:**

- Create: `apps/ucmc-web/src/server/settings/site-notice.ts`. It is pure and client-safe, with no server imports.
- Modify: `apps/ucmc-web/src/server/settings/settings-registry.ts` (category, four entries, `optionLabels?: Record<string, string>` on `SettingMeta`)
- Modify: `apps/ucmc-web/src/features/settings/components/auto-form/introspect.ts`
- Modify: `apps/ucmc-web/src/features/settings/components/setting-row.tsx`
- Modify: `apps/ucmc-web/src/features/settings/server/settings-actions.server.ts` (audit metadata)
- Modify: `apps/ucmc-web/src/features/settings/server/settings-actions-read.server.ts` and `settings-fns.ts` (`SettingHistoryEntry.enumValue`)
- Modify: `apps/ucmc-web/src/features/settings/components/setting-history-dialog.tsx`
- Test: `auto-form-type.test.ts`, `setting-row.test.tsx`, `settings-actions.test.ts`, `setting-permissions.test.ts`

**Interfaces:**

- Consumes: `settingPermissionOf`, `SETTINGS_PAGE_PERMISSIONS` (Task 1).
- Produces, from `site-notice.ts`:
  - `NOTICE_TONES = ["info","success","warning","danger","neutral"] as const` and `NoticeTone`.
  - `NOTICE_AUDIENCES = ["public","members"] as const` and `NoticeAudience`.
- Produces, from `introspect.ts`:
  - `AutoFormType` gains `"enum"`.
  - `enumOptions(schema: z.ZodTypeAny): readonly string[]`, which returns `[]` for a non-enum. It reads `.options` off the unwrapped `ZodEnum`.
- Produces, from `setting-row.tsx`:
  - An optional prop `renderOption?: (value: string) => React.ReactNode` on `SettingRow`.
- Produces, on the history entry:
  - `SettingHistoryEntry.enumValue: string | null`.

- [ ] **Step 1: Write failing tests.**
  - `auto-form-type.test.ts`:
    - `autoFormType(SETTINGS["notice.tone"])` is `"enum"`.
    - `enumOptions(SETTINGS["notice.audience"])` equals `["public","members"]`.
    - `enumOptions(SETTINGS["notice.text"])` equals `[]`.
    - The existing "every setting is renderable" `it.each` already covers the new keys.
  - `setting-permissions.test.ts`:
    - Each `notice.*` key maps to `"notice:manage"`.
    - `SETTINGS_PAGE_PERMISSIONS` equals `["settings:manage","notice:manage"]`.
  - `settings-actions.test.ts`:
    - A `notice:manage`-only principal can update each of the four keys (`{ ok: true }`).
    - `listSiteSettingsAction()` keys equal exactly the four `notice.*` keys.
    - Updating `notice.audience` to `"public"` writes audit metadata `{ key: "notice.audience", value: "public" }`.
    - Updating `notice.text` writes `{ key: "notice.text" }` with no value.
    - `listSettingHistoryAction({ key: "notice.audience" })[0].enumValue` is `"public"`, and `booleanValue` is `null`.
    - A `notice:manage`-only principal asking for history on `contact.clubEmail` is rejected.
  - `setting-row.test.tsx`, for `notice.tone`:
    - It renders a combobox, not a pencil.
    - Choosing "Warning" calls the mocked `mutateAsync` with `{ key: "notice.tone", value: "warning" }` immediately, with no tick button.
    - The reset and history buttons are present before and after the change.
    - The option text comes from `optionLabels`. For audience, assert the option "Approved members" exists.

- [ ] **Step 2: Run and confirm failure.**
      `pnpm --filter ucmc-web exec vitest run src/features/settings`
      Expected: FAIL, because the keys are unknown.

- [ ] **Step 3: Implement.**
  - **Registry.** Add `notice` to `SETTING_CATEGORIES` and `CATEGORY_LABELS` (`"Notice"`). Add the four entries with `permission: "notice:manage"`, schemas per Global Constraints, built from `NOTICE_TONES` / `NOTICE_AUDIENCES`.
  - **Labels and descriptions:**

    | Key               | Label         | Description                                                                                        | `optionLabels`                                                                                   |
    | ----------------- | ------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
    | `notice.enabled`  | "Show notice" | "Turns the banner on or off. Turning it off keeps the text, so it can be switched back on later."  |                                                                                                  |
    | `notice.text`     | "Notice text" | "One line, up to 200 characters. On narrow screens a long notice scrolls sideways."                |                                                                                                  |
    | `notice.audience` | "Audience"    | "Who sees the notice. Members means approved members; people still mid-registration don't see it." | `{ public: "Everyone", members: "Approved members" }`                                            |
    | `notice.tone`     | "Tone"        | "The banner's colour. Every tone meets WCAG AA contrast in light and dark mode."                   | `{ info: "Info", success: "Success", warning: "Warning", danger: "Danger", neutral: "Neutral" }` |

  - **`autoFormType`** returns `"enum"` for `_def.type === "enum"`.
  - **`SettingRow`** gets an `"enum"` branch: a shadcn `Select` whose `onValueChange` calls `requestSave(value)` (`useSettingSaver`, so `meta.confirm` still applies), laid out like the boolean branch with `RowActions` trailing. Option text is `meta.optionLabels?.[v] ?? v`, prefixed by `renderOption?.(v)` when given.
  - **Audit metadata** in `updateSettingAction`: include `value` when `typeof value === "boolean"` **or** the key's schema is an enum (`autoFormType(...) === "enum"` or an equivalent registry helper; don't import UI code into the server; put a `isEnumSetting(key)` in the registry if needed).
  - **History parse** sets `enumValue` when `typeof parsed.value === "string"`.
  - **History dialog** shows `optionLabels[enumValue] ?? enumValue` as a secondary badge when present.

- [ ] **Step 4: Run the tests.**
      `pnpm --filter ucmc-web exec vitest run src/features/settings`
      Expected: PASS.

- [ ] **Step 5: Commit** as `feat(ucmc-web): notice settings and enum rows in /settings`.

---

### Task 3: Who sees the notice (pure rule, server read, query, root prefetch)

**Files:**

- Modify: `apps/ucmc-web/src/server/settings/site-notice.ts`
- Modify: `apps/ucmc-web/src/features/settings/server/settings-actions-read.server.ts` (`getSiteNoticeAction`)
- Modify: `apps/ucmc-web/src/features/settings/server/settings-fns.ts` (`getSiteNoticeFn`, `SiteNotice` re-export)
- Modify: `apps/ucmc-web/src/features/settings/api/query-keys.ts`, `api/queries.ts`
- Modify: `apps/ucmc-web/src/routes/__root.tsx` (loader)
- Modify: `apps/ucmc-web/eslint.config.js` only if `FEATURE_PUBLIC_API` for settings names exported symbols. `queries.ts` is already public.
- Test: `apps/ucmc-web/src/server/settings/__tests__/site-notice.test.ts` (new), `settings-actions.test.ts`

**Interfaces:**

- Consumes: `NoticeTone`, `NoticeAudience` (Task 2).
- Produces, from `site-notice.ts`:
  - `type SiteNotice = { text: string; tone: NoticeTone }`
  - `type NoticeViewer = "anonymous" | "pending" | "approved"`
  - `noticeViewerOf(principal: { status: string } | null): NoticeViewer`
  - `resolveSiteNotice(settings: { enabled: boolean; text: string; audience: NoticeAudience; tone: NoticeTone }, viewer: NoticeViewer): SiteNotice | null`
- Produces, from `settings-actions-read.server.ts`:
  - `getSiteNoticeAction(): Promise<SiteNotice | null>`
- Produces, from `query-keys.ts`:
  - `siteNoticeQueryKey(viewer: NoticeViewer)` returns `["site-settings", "notice", viewer] as const`
- Produces, from `queries.ts`:
  - `siteNoticeQueryOptions(viewer: NoticeViewer)` returns `{ queryKey, queryFn: () => getSiteNoticeFn() }` with no `placeholderData`, since a default notice is "none" and the loader prefetches.

- [ ] **Step 1: Write failing tests.**

  `site-notice.test.ts`, table-driven over `resolveSiteNotice`:

  | enabled | text | audience | viewer                         | expected               |
  | ------- | ---- | -------- | ------------------------------ | ---------------------- |
  | false   | "Hi" | public   | approved                       | `null`                 |
  | true    | ""   | public   | approved                       | `null`                 |
  | true    | " "  | public   | anonymous                      | `null`                 |
  | true    | "Hi" | members  | anonymous                      | `null`                 |
  | true    | "Hi" | members  | pending                        | `null`                 |
  | true    | "Hi" | members  | approved                       | `{ text: "Hi", tone }` |
  | true    | "Hi" | public   | anonymous / pending / approved | `{ text: "Hi", tone }` |

  `site-notice.test.ts` also covers `noticeViewerOf`:
  - `null` returns `"anonymous"`.
  - `{status:"approved"}` returns `"approved"`.
  - `"pending"` and `"deactivated"` both return `"pending"`.

  `site-notice.test.ts` also covers the query keys:
  - `siteNoticeQueryKey("anonymous")` does not equal `siteNoticeQueryKey("approved")`.
  - Both start with `["site-settings"]`, so `useUpdateSetting`'s prefix invalidation covers them.

  `settings-actions.test.ts`, with `describe("getSiteNoticeAction")`, seeding settings via `updateSettingAction` as a manager:
  - With a members notice on, it returns `null` signed out, `null` for a seeded user with `status: "pending"`, and `{ text, tone }` for an approved member.
  - With a public notice on, it returns the notice signed out.
  - On a fresh database (no rows), it returns `null`.

- [ ] **Step 2: Run and confirm failure.**
      `pnpm --filter ucmc-web exec vitest run src/server/settings src/features/settings/server`
      Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`resolveSiteNotice`** returns the notice with `text` trimmed.
  - **`getSiteNoticeAction`** reads the four settings with `readSetting` in a `Promise.all`, calls `loadCurrentPrincipal()`, and returns `resolveSiteNotice(..., noticeViewerOf(principal))`. Give it a doc comment in the style of its neighbours: allowlisted, its own payload, decided on the server so members text never ships to a signed-out browser.
  - **`getSiteNoticeFn`** is a GET shell with a one-line dynamic import.
  - **Root loader:**

    ```ts
    loader: async ({ context }) => {
      const session = await context.queryClient.ensureQueryData(sessionQueryOptions());
      await context.queryClient.ensureQueryData(
        siteNoticeQueryOptions(noticeViewerOf(session.principal)),
      );
    },
    ```

    Keep the existing comment and extend it with one line about the notice, so the banner is in the SSR HTML and doesn't push the page down after hydration.

- [ ] **Step 4: Run the tests.** Same command as Step 2. Expected: PASS.

- [ ] **Step 5: Add `site-notice.ts` to `stryker.config.json` `mutate`, since it is pure.** Run `pnpm --filter ucmc-web test:mutation`. Every `resolveSiteNotice` / `noticeViewerOf` mutant must be killed. Add a table row for any that survive.

- [ ] **Step 6: Commit** as `feat(ucmc-web): decide on the server who sees the site notice`.

---

### Task 4: Tone tokens, contrast gate, and the banner in the shell

**Files:**

- Modify: `apps/ucmc-web/src/styles.css`:
  - In `:root` and `.dark`: `--notice-<tone>` and `--notice-<tone>-foreground` for all five tones.
  - In `@theme inline`: `--color-notice-<tone>` and `--color-notice-<tone>-foreground`.
  - A `@keyframes site-notice-marquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }`.
- Create: `apps/ucmc-web/src/components/layouts/site-notice-banner.tsx`
- Modify: `apps/ucmc-web/src/components/layouts/app-layout.tsx` (mount in `SidebarInset` before `<main>`)
- Test: `apps/ucmc-web/src/components/layouts/__tests__/notice-contrast.test.ts` (new), `apps/ucmc-web/src/components/layouts/__tests__/site-notice-banner.test.tsx` (new)

**Interfaces:**

- Consumes: `SiteNotice`, `NoticeTone`, `NOTICE_TONES`, `noticeViewerOf` (Tasks 2–3), `siteNoticeQueryOptions` (Task 3), `useAuth().principal`.
- Produces:
  - `SiteNoticeBar({ text, tone }: SiteNotice): JSX.Element`, presentational and used by Task 5.
  - `SiteNoticeBanner(): JSX.Element | null`.
  - `marqueeDurationSeconds(stripWidthPx: number): number`, which is `stripWidthPx / 60`.
  - `TONE_CLASSES: Record<NoticeTone, string>`, literal class strings so Tailwind sees them: `bg-notice-info text-notice-info-foreground` and so on, plus the matching `outline-notice-<tone>-foreground` for the button.

- [ ] **Step 1: Write the failing contrast test** in `notice-contrast.test.ts`. Import the stylesheet with `import css from "#/styles.css?raw"`. If the workers pool can't resolve `?raw`, rename the file to `.test.tsx` so it runs in the dom pool. Then:
  - `parseBlock(css, selector)` returns a `Map<string, string>` of custom properties, for `:root` and `.dark`.
  - `oklchToRgb("oklch(L C H)")` converts OKLCH → OKLab → linear sRGB, clamped to [0,1] (Björn Ottosson's matrices).
  - `relativeLuminance` uses linear sRGB, since OKLab gives you linear values directly: `0.2126R + 0.7152G + 0.0722B`.
  - `contrast(a, b)` is `(Lmax + 0.05) / (Lmin + 0.05)`.

  The cases:
  - `it.each(NOTICE_TONES × ["light","dark"])`: both tokens exist, and `contrast(bg, fg) >= 4.5`.
  - A sanity case: the existing `--header` / `--header-foreground` light pair measures above 4.5, which proves the parser and the maths against a known-good pair.
  - Failure messages print the measured ratio, e.g. `` `${tone} ${theme}: ${ratio.toFixed(2)}:1` ``.

- [ ] **Step 2: Run and confirm failure.**
      `pnpm --filter ucmc-web exec vitest run src/components/layouts/__tests__/notice-contrast.test.ts`
      Expected: FAIL, because the tokens are missing.

- [ ] **Step 3: Add the tokens.**
  - Pick the hues: info blue, success green, warning amber, danger red, neutral zinc. Light mode uses deep backgrounds with a near-white foreground, except warning, which uses a light amber background with a near-black foreground. Dark mode is re-stepped against the dark page, not flipped.
  - Map them into `@theme inline` next to `--color-header`.
  - Iterate until the test passes. Note the measured ratios in a comment above the block, per the `app-chrome` rule's "measured, not asserted".

- [ ] **Step 4: Write the failing banner tests** in `site-notice-banner.test.tsx`. Stub `ResizeObserver` with a controllable class that captures its callback. Stub `scrollWidth`/`clientWidth` via `Object.defineProperty` on the measured elements, and `window.matchMedia`.
  - `SiteNoticeBar` renders `getByRole("complementary", { name: "Site notice" })` containing the text, with the tone's classes.
  - **When the text fits** (scrollWidth ≤ clientWidth): exactly one text node is present, there is no button, and the text has `truncate`.
  - **When it overflows**, after firing the observer: the text appears twice, and the second copy's container has `aria-hidden="true"`. `getByRole("button", { name: "Pause notice" })` exists with `aria-pressed="false"`. Clicking it changes the name to "Play notice", sets `aria-pressed="true"`, and sets the strip's inline `animationPlayState` to `paused`. The strip's `animationDuration` equals `` `${marqueeDurationSeconds(width)}s` ``.
  - **Overflow, then fit** (fire the observer again with widths changed): it is back to one copy and no button. This is Review Focus 3.
  - **Under reduced motion** (`matchMedia("(prefers-reduced-motion: reduce)").matches === true`) with overflowing widths: one copy, no button, and the text has `whitespace-normal`, not `truncate`.
  - **`SiteNoticeBanner`**: render it with `authStub` (no principal) and a `QueryClient` seeded with `siteNoticeQueryKey("anonymous")` set to `null`, and expect nothing rendered. Seed `"approved"` with a notice and use an approved `authStub` principal, and expect the bar. This is Review Focus 5.
  - `marqueeDurationSeconds(600) === 10`.

- [ ] **Step 5: Run and confirm failure.**
      `pnpm --filter ucmc-web exec vitest run src/components/layouts/__tests__/site-notice-banner.test.tsx`
      Expected: FAIL.

- [ ] **Step 6: Implement `site-notice-banner.tsx`:**
  - **Outer element:** `<aside aria-label="Site notice" className={cn("sticky top-(--header-height) z-20 flex min-h-9 items-center gap-2 px-4 text-sm font-medium", TONE_CLASSES[tone])}>`. No border.
  - **Viewport:** a `div` with `overflow-hidden flex-1`, holding the strip.
  - **Overflow detection:** `const [overflowing, setOverflowing] = useState(false)`. A `useLayoutEffect` (client only) creates a `ResizeObserver` on the viewport that compares the first copy's `scrollWidth` with the viewport's `clientWidth`. The initial state is `false`, so the server and first client render are the static, truncated version.
  - **Reduced motion:** `usePrefersReducedMotion()` reads `matchMedia` in an effect, defaulting to `false`, and listens for changes. If `src/hooks/` already has a reduced-motion hook, use that instead.
  - **Marquee mode** (`overflowing && !reducedMotion`): the strip is `inline-flex w-max` with two copies, each followed by a `pr-12` gap, and the second wrapper is `aria-hidden`. The inline style is `animation: site-notice-marquee <d>s linear infinite`, with `animationPlayState` set to paused when `paused || hovered || focusWithin`. Track hover with `onPointerEnter`/`onPointerLeave` and focus with `onFocus`/`onBlur` on the `aside`. The pause/play `Button` (`variant="ghost" size="icon"`, lucide `Pause`/`Play`, `aria-pressed`, `aria-label` "Pause notice"/"Play notice") uses `TONE_CLASSES`' outline class for `focus-visible`.
  - **Reduced motion with overflow:** a single copy with `whitespace-normal`, and no button.
  - **`SiteNoticeBanner`:** `const { principal } = useAuth(); const { data } = useQuery(siteNoticeQueryOptions(noticeViewerOf(principal)));` It returns `data ? <SiteNoticeBar {...data} /> : null`.
  - **Mount:** in `app-layout.tsx`, `<SiteNoticeBanner />` goes as the first child of `SidebarInset`, before `<main>`.

- [ ] **Step 7: Run both test files.** Expected: PASS.

- [ ] **Step 8: Look at it in the running app.**
  - Run `pnpm --filter ucmc-web dev`, and set a notice through `/settings` as a system admin. The editor UI arrives in Task 5; until then, toggle `notice.enabled` with the generic rows.
  - Check at 375px and 1280px, in light and dark:
    - the bar sits under the header and doesn't span the sidebar;
    - it stays visible when scrolling;
    - long text scrolls and loops seamlessly;
    - it pauses on hover;
    - with reduced motion emulated in devtools, the text wraps.
  - Then load the page signed out with a members notice on, and confirm `view-source:` doesn't contain the notice text (Review Focus 1).

- [ ] **Step 9: Commit** as `feat(ucmc-web): site notice banner with AA-checked tones`.

---

### Task 5: `NoticePanel` and the per-permission `/settings` page

**Files:**

- Create: `apps/ucmc-web/src/features/settings/components/notice-panel.tsx`
- Modify: `apps/ucmc-web/src/routes/settings.tsx`
- Test: `apps/ucmc-web/src/features/settings/components/__tests__/notice-panel.test.tsx` (new), `apps/ucmc-web/src/routes/__tests__/settings.test.tsx` (new, or the existing route test file if one exists)

**Interfaces:**

- Consumes: `SiteNoticeBar` (Task 4), `SettingRow` with `renderOption` (Task 2), `canEditSetting`, `settingPermissionOf` (Task 1), `useAuth().hasPermission`.
- Produces: `NoticePanel({ entries }: { entries: SiteSettingsSnapshot | undefined }): JSX.Element`.

- [ ] **Step 1: Write failing tests.**
  - `notice-panel.test.tsx`, with `useUpdateSetting` mocked as in `setting-row.test.tsx`:
    - With entries `{ enabled: false, text: "Gear due Friday", tone: "warning", audience: "members" }`, the preview contains "Gear due Friday" and the text "Preview (not live)", plus the caption "Visible to: approved members".
    - With `enabled: true`, the "not live" label is gone.
    - The tone select's options each render a swatch element with the tone's `bg-notice-*` class.
    - All four `SettingRow`s are present by their labels.
  - `settings.test.tsx`, rendering `SettingsPage` with `authStub(["notice:manage"])` and a snapshot holding only the `notice.*` keys:
    - The heading "Notice" is present.
    - "Contact" and "Pages" are absent.
    - The stale-review summary is absent.
    - With `authStub(["settings:manage", "notice:manage"])`, every category renders. A `system_admin`'s effective set contains both.

- [ ] **Step 2: Run and confirm failure.**
      `pnpm --filter ucmc-web exec vitest run src/features/settings/components src/routes/__tests__/settings.test.tsx`
      Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`NoticePanel`** is a `section` headed `CATEGORY_LABELS.notice`. It contains a preview card, `SiteNoticeBar` fed from `entries`, with a non-sticky wrapper override: pass `className` or render inside a `relative` container, and make the bar accept an optional `className` merged by `cn()`. Above the bar sits a muted label, "Preview (not live)" when disabled and "Live" when enabled. Below it is the "Visible to: …" caption, using the audience `optionLabels` in lowercase after "Visible to:". The four `SettingRow`s follow, with `renderOption` for `notice.tone` drawing a `size-3 rounded-full` swatch in `TONE_CLASSES`' background.
  - **`routes/settings.tsx`:**
    - Read `useAuth().hasPermission`.
    - Render a category only when some key in it passes `hasPermission(settingPermissionOf(key))`.
    - Route `category === "notice"` to `NoticePanel`, in the same way `pages` routes to `PageFlagsPanel`.
    - Render `StaleSummary` only when `hasPermission("settings:manage")`.

- [ ] **Step 4: Run the tests.** Same command. Expected: PASS.

- [ ] **Step 5: Run the full check.** `pnpm verify` should come back with lint, typecheck, knip, `db:drift` and tests all green. If knip flags the new route test or a new export, follow the CLAUDE.md knip guidance and don't suppress blindly.

- [ ] **Step 6: Commit** as `feat(ucmc-web): edit the site notice on /settings with a live preview`.

---

### Task 6: Docs

**Files:**

- Modify: `.claude/rules/site-settings.md`
  - Intro: `/settings` is gated per key, with `settings:manage` as the default and `permission` meta overriding it, plus `SETTINGS_PAGE_PERMISSIONS`.
  - Replace "Every setting is a scalar…" so `"enum"` is listed, with enums applying on change like booleans.
  - The audit policy now records enum values.
  - Under "The public subset": `getSiteNoticeFn` is the fourth public read and the only viewer-dependent one, decided by `resolveSiteNotice` and keyed by `NoticeViewer`.
  - A short "The notice renderer" paragraph beside "The `pages` renderer".
- Modify: `.claude/rules/app-chrome.md`. Add a "Site notice" section:
  - placement inside `SidebarInset` and z-order under the header;
  - the reduced-motion wrap as a deliberate break of one-line;
  - the focus ring using the tone foreground rather than `--ring`;
  - the contrast test as the gate for the `--notice-*` tokens.
- Modify: `.claude/rules/auth/access.md`, or wherever that rule lists permissions (grep for `analytics:view`). Add `notice:manage`.
- Modify: the `paths:` front-matter of `site-settings.md` only if a new file needs to load it (`src/server/settings/**` already covers `site-notice.ts`).

- [ ] **Step 1: Make the edits.** Run `pnpm format`.
- [ ] **Step 2: Check the docs against the code.** Run `pnpm --filter ucmc-web exec vitest run src/features/settings src/server/settings src/components/layouts` and expect PASS. Re-read each edited paragraph against the code it describes.
- [ ] **Step 3: Commit** as `docs(global): site notice and per-key setting permissions in the rules`.
- [ ] **Step 4: Open the PR** following the PR-flow memory: `/code-review --fix`, judge the findings, `pnpm verify`, then `gh pr create`. The user merges.
