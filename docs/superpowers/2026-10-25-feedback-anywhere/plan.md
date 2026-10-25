# Feedback from anywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members send site or club feedback from a user-menu modal on any page (site reports carry the real page URL and an automatic screenshot), see their own feedback at `/my/feedback`, and `/feedback/*` becomes a managers-only area.

**Architecture:** A feature-agnostic launcher context (`src/components/feedback/`) is provided by `AppLayout`, which mounts a dialog composing both feedback features; `UserMenu` only calls `open()`. Screenshots are DOM-rasterised client-side with `modern-screenshot`, sent as a `data:` URL like avatars, stored in the private R2 bucket, served by a permission-checked route, and swept 30 days after the report resolves by the daily retention tick.

**Tech Stack:** TanStack Start + Router, React 19, TanStack Form/Query, Drizzle on D1, R2, Vitest (workers + jsdom pools), Playwright, Pulumi (`@pulumi/cloudflare` 6.17.0), `modern-screenshot@4.7.0`.

**Spec:** `docs/superpowers/2026-10-25-feedback-anywhere/design.md`

## Global Constraints

- One PR, branch `feat/feedback-anywhere`; every task is one green, independently revertable Conventional Commit (scope `ucmc-web`, `infra-cloudflare` for Pulumi). Forms leave `/feedback` only after the modal exists (Task 4 after Task 3).
- Migrations only add, and go through `pnpm --filter ucmc-web db:generate --name <name>`; never hand-write a migration or journal entry.
- Never read `env.*` at module scope; R2 goes through `getPrivateBucket()` / `getPublicBucket()`.
- Client permission gates use `hasPermission` / `hasAnyPermission`; server gates use `effectivePermissionsFor` (role emulation honoured).
- Features don't import each other. Only `src/routes/` and `src/components/layouts/` compose `site-feedback` and `club-feedback` together. `src/server/` and `src/lib/` import no feature.
- Every mutation keeps its `use-*.ts` hook; no inline `useMutation`.
- `const` only, braces always, strict equality.
- Screenshots: private bucket only, key prefix `site-feedback/screenshots/`, `image/webp` or `image/jpeg`, **1 MB (1 048 576 bytes) decoded max**, at most 1600 px wide, 3 s capture timeout, **never in any GitHub payload**, deleted **30 days** after resolution.
- Copy fixed by the spec: menu items "Send feedback…" / "My feedback"; checkbox "Include screenshot"; helper "Visible only to you and site maintainers. Never posted publicly."; toast "Thanks — see it in My feedback"; purged note "Screenshot deleted 30 days after resolution."; GitHub quote line "Screenshot attached (visible in triage)."; empty section "Nothing yet".
- Do not edit `/privacy` or `src/config/legal.ts` (legal review; flagged in the PR body as blocking prod).
- `modern-screenshot` pinned exactly to `4.7.0` (published 2026-04-16, outside the 7-day quarantine).
- Narrowest test first: `pnpm --filter ucmc-web exec vitest run <path relative to apps/ucmc-web>`; `pnpm verify` before the PR.

## Review Focus

1. **Capture fails** (a CORS-less image, a slow phone, an exception inside `modern-screenshot`): the modal must still open, just without a thumbnail. Pinned in Task 3 (`opens without a screenshot when capture rejects`) and Task 8 (`captureViewport resolves null on timeout`).
2. **A refused submission must not leave an R2 object** (submissions paused, rate-limited, invalid image): the checks run before `put`. Pinned in Task 6 (`writes nothing to R2 when submissions are disabled` / `…when rate-limited`).
3. **Unticking "Include screenshot" means nothing is uploaded**, and the kind-based default stops applying once the member has touched the box. Pinned in Task 8.
4. **Club → Back → Site keeps the screenshot**; it is discarded only by submitting club feedback or closing the dialog. Pinned in Task 3.
5. **A reopened report keeps its screenshot**: a Reopen restamps `status_changed_at` and status `open` is never due. Pinned in Task 9 (`not due once reopened`).

---

### Task 1: `/my/feedback` page and the "My feedback" menu half

**Files:**

- Modify: `apps/ucmc-web/src/server/settings/settings-registry.ts` (after `pages.my_gear_cart`)
- Create: `apps/ucmc-web/src/routes/my.feedback.tsx`
- Modify: `apps/ucmc-web/src/features/auth/components/user-menu.tsx`
- Modify: `apps/ucmc-web/src/features/auth/guards.ts`
- Test: `apps/ucmc-web/src/features/auth/components/__tests__/user-menu.test.tsx` (create), `apps/ucmc-web/src/features/auth/__tests__/guards.test.ts`. The repo has no route-component tests; route bodies are covered by Task 11's e2e, and route guards by pure decision functions in `guards.ts`.
- Modify: `.claude/rules/auth/core.md` (the `/my/*` paragraph lists `/my/feedback` as a direct sibling)

**Interfaces:**

- Produces: `export function canReachMyFeedback(granted: readonly string[]): boolean` (true when `granted` has `site_feedback:submit` or `club_feedback:submit`); page flag key `my_feedback`; route `/my/feedback`; a `FeedbackMenuRow` region in `UserMenu` with `data-testid="feedback-menu-row"`, whose send half is added in Task 3.

- [ ] **Step 1: Write failing tests.** User menu (approved principal, flags mocked): `shows My feedback when pages.my_feedback is on and the member holds site_feedback:submit`; `hides My feedback when pages.my_feedback is off`; `hides My feedback when the member holds neither submit permission`; the link's `href` is `/my/feedback`. Guards: `canReachMyFeedback` true for either submit permission alone, false for neither (manage alone is false).
- [ ] **Step 2: Run them, expect FAIL** (`pnpm --filter ucmc-web exec vitest run src/features/auth/components/__tests__/user-menu.test.tsx src/features/auth/__tests__/guards.test.ts`).
- [ ] **Step 3: Add the `pages.my_feedback` registry entry**: default `true`, `category: "pages"`, `flagKind: "release"`, `owner: "system_admin"`, `createdAt: "2026-10-25"`, `parent: "my"`, label "My Feedback enabled", description "When off, the My feedback link is hidden and /my/feedback returns notFound."
- [ ] **Step 4: Create `my.feedback.tsx`** per the `add-page-flag` skill's nested-route rule: `staticData: { pageFlag: "my_feedback" }`, `requirePageFlag(context.queryClient, "my_feedback")` in its own `beforeLoad`, then `notFound()` unless `canReachMyFeedback(await effectivePermissionsFor(...))`. Page: `PageContainer width="app"`, `<h1>My feedback</h1>`, a header button "Send feedback…" (rendered only when `useFeedbackLauncher().canSend`; until Task 2 lands, omit it and add it in Task 3), then sections "Website" (`mySiteFeedbackQueryOptions`, `SiteFeedbackCard`) and "Club" (`myClubFeedbackQueryOptions`, `ClubFeedbackCard` with `showSubmitter={false} canManage={false} isOwn`), each gated by `hasPermission` on its submit permission, newest first, empty state "Nothing yet".
- [ ] **Step 5: Add the menu row** after "My Cart" in `UserMenu`: a `div` with `data-testid="feedback-menu-row" className="flex"` holding a `DropdownMenuItem asChild` link "My feedback" (`MessageSquare`-style lucide icon). Gate: `pages.my_feedback && hasAnyPermission(["site_feedback:submit", "club_feedback:submit"])`; render nothing when the gate is off.
- [ ] **Step 6: Run `pnpm --filter ucmc-web build`** so `routeTree.gen.ts` picks up the route, then rerun the Step 2 tests: PASS. `pnpm --filter ucmc-web exec vitest run src/server/settings` (page-flag cascade test): PASS.
- [ ] **Step 7: Commit** `feat(ucmc-web): /my/feedback lists a member's own site and club feedback` (include `routeTree.gen.ts` and the rule edit).

### Task 2: The feature-agnostic launcher

**Files:**

- Create: `apps/ucmc-web/src/components/feedback/feedback-launcher.tsx`
- Test: `apps/ucmc-web/src/components/feedback/__tests__/feedback-launcher.test.tsx`

**Interfaces:**

- Produces:

  ```ts
  export interface CapturedScreenshot {
    dataUrl: string;
    contentType: "image/webp" | "image/jpeg";
    bytes: number;
  }
  export interface FeedbackPageContext {
    pageUrl: string;
    userAgent: string;
    screenshot: CapturedScreenshot | null;
  }
  export function FeedbackLauncherProvider(props: {
    canSend: boolean;
    captureScreenshot: boolean;
    capture: () => Promise<CapturedScreenshot | null>;
    children: React.ReactNode;
  }): JSX.Element;
  export function useFeedbackLauncher(): { canSend: boolean; open: () => void };
  export function useFeedbackLauncherState(): {
    isOpen: boolean;
    context: FeedbackPageContext | null;
    close: () => void;
  };
  ```

- [ ] **Step 1: Write failing tests**: `useFeedbackLauncher without a provider returns canSend false and a no-op open`; `open records pageUrl and userAgent at open time` (change `window.location` via `history.pushState` before `open`, then again after: context keeps the first URL); `open calls capture only when captureScreenshot is true`; `opens with screenshot null when capture rejects`; `close clears the context`; `userAgent is truncated to 500 characters`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `open()` waits one `requestAnimationFrame`, then (when `captureScreenshot`) awaits `capture()` with any rejection mapped to `null`, records `window.location.href` and `navigator.userAgent.slice(0, 500)`, sets `isOpen`. A second `open()` while one is capturing is ignored. `capture` is injected so this file imports no screenshot library and stays feature-blind.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(ucmc-web): feedback launcher context`.

### Task 3: The feedback dialog and the "Send feedback…" menu half

**Files:**

- Create: `apps/ucmc-web/src/components/layouts/feedback-dialog.tsx`
- Modify: `apps/ucmc-web/src/components/layouts/app-layout.tsx` (provider around the shell, dialog mounted once)
- Modify: `apps/ucmc-web/src/features/site-feedback/components/site-feedback-form.tsx`
- Modify: `apps/ucmc-web/src/features/club-feedback/components/club-feedback-form.tsx`
- Modify: `apps/ucmc-web/src/features/auth/components/user-menu.tsx`, `apps/ucmc-web/src/routes/my.feedback.tsx` (header button)
- Test: `apps/ucmc-web/src/components/layouts/__tests__/feedback-dialog.test.tsx`, extend `user-menu.test.tsx`, extend existing form tests if present

**Interfaces:**

- Consumes: Task 2's provider and hooks.
- Produces:

  ```ts
  // feedback-dialog.tsx
  export function useFeedbackSurfaces(): { site: boolean; club: boolean };
  export function FeedbackDialog(props: {
    surfaces: { site: boolean; club: boolean };
  }): JSX.Element | null;
  // site-feedback-form.tsx
  export function SiteFeedbackForm(props: {
    pageContext: FeedbackPageContext;
    onSubmitted?: () => void;
  }): JSX.Element;
  // club-feedback-form.tsx
  export function ClubFeedbackForm(props: {
    onSubmitted?: () => void;
  }): JSX.Element;
  ```

  `useFeedbackSurfaces`: `site = isApproved && hasPermission("site_feedback:submit") && flags.siteFeedback`; `club = isApproved && hasPermission("club_feedback:submit") && flags.clubFeedback` (flags from `publicFlagsQueryOptions`, defaulting to placeholder data).

- [ ] **Step 1: Write failing tests** (dialog driven through a test provider with an injected `capture`): `skips the chooser when only site is available`; `shows Club and Site choices when both are`; `Back returns to the chooser`; `Club → Back → Site still has the screenshot` (Review Focus 4); `submitting club feedback sends no pageUrl and closes`; `closing discards the context, so the next open recaptures`; `opens without a screenshot when capture rejects` (Review Focus 1); `site submit sends the pageUrl captured at open, not the current location`; success shows toast "Thanks — see it in My feedback". User menu: `Send feedback… renders when canSend`, `row shows only My feedback when canSend is false`, `row is absent when both halves are off`, `both halves are separate menuitems in DOM order`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Change the forms.** `SiteFeedbackForm` takes `pageContext` and uses its `pageUrl` / `userAgent` in `onSubmit` instead of reading `window`/`navigator`; both forms call `onSubmitted?.()` after their existing success handling and drop their outer `rounded-md border p-4` card styling when rendered in the dialog (pass a `className` or move the border to the old call sites, which disappear in Task 4).
- [ ] **Step 4: Implement `FeedbackDialog`**: step state `"choose" | "site" | "club"`, initial step from `surfaces` (one surface skips "choose"); chooser copy mirrors `FeedbackIndexCards`' two descriptions; "Back" button on the form steps when both surfaces exist. Desktop `Dialog`, phones a full-height bottom `Sheet` (`useIsMobile()` from `#/hooks/use-mobile`). `onSubmitted` → `toast.success("Thanks — see it in My feedback")` then `close()`.
- [ ] **Step 5: Wire `AppLayout`**: `const surfaces = useFeedbackSurfaces()`; wrap the shell in `<FeedbackLauncherProvider canSend={surfaces.site || surfaces.club} captureScreenshot={false} capture={async () => null}>` (screenshots switch on in Task 8) and render `<FeedbackDialog surfaces={surfaces} />` once inside it.
- [ ] **Step 6: Add the send half** to the Task 1 row: `DropdownMenuItem` "Send feedback…" with `onSelect={() => launcher.open()}`, rendered when `useFeedbackLauncher().canSend`; when both halves render, each is `flex-1`. Add the same `open()` button to the `/my/feedback` header and empty states.
- [ ] **Step 7: Run tests, expect PASS**; also `pnpm --filter ucmc-web lint` (feature-boundary zones).
- [ ] **Step 8: Commit** `feat(ucmc-web): send feedback from any page through a user-menu modal`.

### Task 4: `/feedback` becomes managers-only

**Files:**

- Modify: `apps/ucmc-web/src/features/auth/guards.ts` (+ `__tests__/guards.test.ts`)
- Modify: `apps/ucmc-web/src/routes/feedback.tsx`, `feedback.index.tsx`, `feedback.site.index.tsx`, `feedback.club.tsx`
- Modify: `apps/ucmc-web/src/components/feedback/feedback-index-cards.tsx` (+ its test)
- Modify: `apps/ucmc-web/src/components/layouts/app-layout.tsx` (sidebar gate, ~line 641)
- Modify: `apps/ucmc-web/src/server/settings/settings-registry.ts` (descriptions)
- Modify: `.claude/rules/feedback-index.md`, `feature-site-feedback.md`, `feature-club-feedback.md`, `app-chrome.md` if its sidebar wording names the old gate
- Test: `apps/ucmc-web/src/features/auth/__tests__/guards.test.ts`, `feedback-index-cards.test.tsx`, `sidebar-nav.test.tsx`

**Interfaces:**

- Produces, in `guards.ts`: `export const FEEDBACK_MANAGE_PERMISSIONS = ["site_feedback:manage", "club_feedback:manage"] as const;` and `export function feedbackAreaDecision(granted: readonly string[], myFeedbackEnabled: boolean): "allow" | "redirect_my_feedback" | "not_found"`. `CLUB_FEEDBACK_PERMISSIONS` and `SITE_FEEDBACK_PERMISSIONS` are deleted (knip will report them otherwise).

- [ ] **Step 1: Write failing tests**: `feedbackAreaDecision` `allow for site manage alone`, `allow for club manage alone`, `redirect_my_feedback for submit-only when enabled`, `not_found for submit-only when pages.my_feedback is off`, `redirect_my_feedback for no permissions at all when enabled` (the layout feeds it effective permissions, so a manager previewing a member role lands here); the `/feedback/site` redirect, the club 404 for a site-only manager and the layout redirect are asserted end-to-end in Task 11; `FeedbackIndexCards` `shows no "of yours" badges`; sidebar `shows Feedback only to a manager of a reachable surface`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Guards and routes.** `feedback.tsx` `beforeLoad`: `requireEnabledPages`, `requireApproved`, then `effectivePermissionsFor`; map `feedbackAreaDecision(granted, flags.pages.my_feedback)` to pass / `redirect({ to: "/my/feedback" })` / `notFound()`. `feedback.index.tsx`: reachability is `pages.feedback_<surface> && granted.includes("<surface>_feedback:manage")`. `feedback.site.index.tsx`: `beforeLoad` throws `redirect({ to: "/feedback/site/triage" })`; delete its component, form import and own list. `feedback.club.tsx`: `requirePermissionOrNotFound` on `club_feedback:manage`; remove `ClubFeedbackForm` and the "mine" list, keep the officer list. Breadcrumb "Site" in `feedback.tsx` links to `/feedback/site/triage`.
- [ ] **Step 4: Index cards and sidebar.** Remove the `mineOpen` / `mineTracked` props and badges; the cards keep the manager counts and Triage / Review links. Sidebar gate: `isApproved && pages.feedback && ((pages.feedback_site && hasPermission("site_feedback:manage")) || (pages.feedback_club && hasPermission("club_feedback:manage")))`.
- [ ] **Step 5: Settings descriptions** (registry text only):
  - `pages.feedback`: "Master switch for the managers' /feedback area. When off, the sidebar entry disappears and both surfaces return notFound. Members still send feedback from the user menu."
  - `pages.feedback_site`: "When off, site-feedback triage is hidden and /feedback/site returns notFound. To stop new submissions, use “Accept site feedback submissions” under Features instead."
  - `pages.feedback_club`: the same shape for club review.
  - `*.submissions_enabled`: "Pauses NEW <surface>-feedback submissions: the option disappears from the Send feedback dialog and the endpoint refuses. Managers keep reviewing the backlog."
- [ ] **Step 6: Update the three rule files** to describe manager-only `/feedback`, `FEEDBACK_MANAGE_PERMISSIONS`, the dialog in `components/layouts/feedback-dialog.tsx`, and `/my/feedback`.
- [ ] **Step 7: Run `pnpm --filter ucmc-web build`** (route tree), the Step 1 tests, `pnpm --filter ucmc-web knip`, `pnpm --filter ucmc-web exec playwright test e2e/site-feedback-triage.spec.ts` if runnable locally (see memory note on host e2e); all PASS / clean.
- [ ] **Step 8: Commit** `feat(ucmc-web): /feedback is for site maintainers and the exec board`.

### Task 5: Migration and resolution timestamps

**Files:**

- Modify: `apps/ucmc-web/drizzle/schema.ts` (`siteFeedback`, `siteFeedbackIssues`); generated `drizzle/00NN_feedback_screenshots.sql` + snapshot + journal
- Modify: `apps/ucmc-web/src/features/site-feedback/server/triage-repo.server.ts` (`setDisposition`, `upsertAttachedIssue`)
- Modify: `apps/ucmc-web/src/features/site-feedback/server/sync.server.ts` (`write`)
- Test: `triage-actions.test.ts`, `sync.test.ts`, `triage-github-actions.test.ts`

**Interfaces:**

- Produces columns: `siteFeedback.screenshotKey` (`screenshot_key` text), `.screenshotBytes` (`screenshot_bytes` integer), `.screenshotPurgedAt` (`screenshot_purged_at` timestamp), `.statusChangedAt` (`status_changed_at` timestamp); `siteFeedbackIssues.closedAt` (`closed_at` timestamp). All nullable.

- [ ] **Step 1: Write failing tests**: `a disposition stamps status_changed_at`; `a disposition skipped for a linked report leaves status_changed_at null`; `sync stamps closed_at on issues it closes and leaves open ones null`; `attaching a closed issue stamps closed_at`; `re-attaching an already-closed issue keeps its first closed_at`; `attaching an open issue leaves closed_at null`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Edit `schema.ts`, then `pnpm --filter ucmc-web db:generate --name feedback_screenshots`.** Review the SQL: five `ALTER TABLE … ADD COLUMN` statements and nothing else (a table rebuild is the trap in `data/migrations.md`).
- [ ] **Step 4: Stamp.** `setDisposition` sets `statusChangedAt: now` beside `updatedAt`. Sync's `write("closed", …)` also sets `closedAt: now`. `upsertAttachedIssue` sets `closedAt` to `now` on insert when `state === "closed"`; on conflict, `closedAt` becomes `coalesce(closed_at, now)` when closed and `null` when open.
- [ ] **Step 5: Run the tests and `pnpm --filter ucmc-web db:drift`; PASS / no drift.** `pnpm --filter ucmc-web db:migrate:local` applies cleanly.
- [ ] **Step 6: Commit** `feat(ucmc-web): record when site feedback resolves`.

### Task 6: Screenshot upload on submit

**Files:**

- Create: `apps/ucmc-web/src/server/r2/image-data-url.server.ts`
- Modify: `apps/ucmc-web/src/features/auth/server/avatar-actions.server.ts` (use the shared decoder; behaviour unchanged)
- Create: `apps/ucmc-web/src/server/r2/site-feedback-screenshots.server.ts`
- Modify: `apps/ucmc-web/src/features/site-feedback/server/limits.ts`, `site-feedback-actions.server.ts`, `repo.server.ts` (`insertSiteFeedback`)
- Modify: `.claude/rules/data/r2.md` (the private bucket's first prefix and who agrees on it)
- Test: `site-feedback-actions.test.ts`, `avatar-actions.test.ts` (must stay green untouched), `src/server/r2/__tests__/image-data-url.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // image-data-url.server.ts (moved out of avatar-actions, same magic-byte checks)
  export type ImageContentType = "image/webp" | "image/jpeg" | "image/png";
  export function decodeImageDataUrl(
    dataUrl: string,
    opts: { allowed: readonly ImageContentType[]; maxBytes: number },
  ): { contentType: ImageContentType; bytes: ArrayBuffer };
  // site-feedback-screenshots.server.ts
  export const SITE_FEEDBACK_SCREENSHOT_PREFIX = "site-feedback/screenshots/";
  export function siteFeedbackScreenshotKey(
    feedbackId: string,
    contentType: "image/webp" | "image/jpeg",
  ): string; // prefix + id + ".webp" | ".jpg"
  export async function putSiteFeedbackScreenshot(
    key: string,
    bytes: ArrayBuffer,
    contentType: string,
  ): Promise<void>;
  export async function getSiteFeedbackScreenshot(
    key: string,
  ): Promise<R2ObjectBody | null>;
  export async function deleteSiteFeedbackScreenshots(
    keys: readonly string[],
  ): Promise<void>; // chunks of 1000
  // limits.ts
  export const SITE_FEEDBACK_SCREENSHOT_MAX_BYTES = 1_048_576;
  // every variant of siteFeedbackInputSchema gains:
  screenshotDataUrl: z.string().max(1_400_000).optional();
  ```

- [ ] **Step 1: Write failing tests** (workers pool, real miniflare R2): `stores a webp screenshot under site-feedback/screenshots/<id>.webp and records key and bytes`; `accepts jpeg`; `rejects png`; `rejects bytes that don't match the declared type`; `rejects more than 1 048 576 decoded bytes`; `writes nothing to R2 when submissions are disabled` and `…when rate-limited` (Review Focus 2; check order: enabled → `checkSiteFeedbackRateLimit` → `checkUploadRateLimit` → decode → put → insert); `refuses when checkUploadRateLimit says no`; `deletes the object when the insert fails` (force via a duplicate id or a mocked `insertSiteFeedback`); `submits without a screenshot exactly as before`. Decoder: one test per magic-byte branch.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the decoder (lift `decodeDataUrl` / `matchesMagic` from avatar actions), the R2 helpers on `getPrivateBucket()` (`httpMetadata.contentType` set on put), the schema field, and the submit branch in the order above. `insertSiteFeedback` takes optional `screenshotKey` / `screenshotBytes`.
- [ ] **Step 4: Run the Step 1 tests plus `avatar-actions.test.ts`: PASS.**
- [ ] **Step 5: Commit** `feat(ucmc-web): store a site-feedback screenshot in the private bucket`.

### Task 7: Serving screenshots, payload field, GitHub line

**Files:**

- Create: `apps/ucmc-web/src/routes/api/site-feedback.$id.screenshot.ts`
- Modify: `site-feedback-actions.server.ts` (summary + `getSiteFeedbackScreenshotAction`), `triage-repo.server.ts` (triage row select), `site-feedback-triage-actions.server.ts` (triage/composer payloads), `issue-format.ts` (`quotedReportFor`)
- Create: `apps/ucmc-web/src/features/site-feedback/components/site-feedback-screenshot.tsx`
- Modify: `site-feedback-card.tsx`, the triage card and composer link list under `components/triage/` and `components/composer/`
- Test: `site-feedback-actions.test.ts`, `issue-format.test.ts`, `triage-github-actions.test.ts`, `components/__tests__/site-feedback-card.test.tsx`

**Interfaces:**

- Consumes: Task 6 helpers; Task 5 columns.
- Produces:

  ```ts
  export type SiteFeedbackScreenshotState = "present" | "purged" | null;
  // added to SiteFeedbackSummary and the triage row / composer link payloads:
  screenshot: SiteFeedbackScreenshotState;
  export async function getSiteFeedbackScreenshotAction(
    id: string,
  ): Promise<{ body: ReadableStream; contentType: string } | null>;
  export function siteFeedbackScreenshotUrl(id: string): string; // "/api/site-feedback/<id>/screenshot", in a client-safe module (e.g. limits.ts)
  export function SiteFeedbackScreenshot(props: {
    feedbackId: string;
    state: SiteFeedbackScreenshotState;
  }): JSX.Element | null;
  // quotedReportFor input gains: hasScreenshot: boolean
  ```

- [ ] **Step 1: Write failing tests**: action `returns the image to its submitter`; `to a site_feedback:manage holder`; `null for another member`; `null for a manager previewing a member role`; `null when signed out`; `null once purged`; summary `screenshot is "present" / "purged" / null` and **never includes the key** (`expect(JSON.stringify(summary)).not.toContain("site-feedback/screenshots/")`); `quotedReportFor adds "Screenshot attached (visible in triage)." when hasScreenshot`; the existing GitHub-payload privacy test also asserts `not.toContain("site-feedback/screenshots/")` and `not.toContain("/api/site-feedback/")`; card `renders a thumbnail linking to the full image when present` and `renders "Screenshot deleted 30 days after resolution." when purged`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** The action loads the principal (null → null), reads the row, allows the owner or a viewer whose effective permissions include `site_feedback:manage` (reuse whatever `requireSiteFeedbackViewer` uses for `canManage`, without its throw), then `getSiteFeedbackScreenshot`. The route's `GET` returns 404 for `null`, else the body with `Content-Type`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`. Payload state: `screenshotKey !== null ? "present" : screenshotPurgedAt !== null ? "purged" : null`. `SiteFeedbackScreenshot` is a small `<img loading="lazy">` thumbnail opening a `Dialog` with the full image.
- [ ] **Step 4: Run tests, `pnpm --filter ucmc-web build`, `knip`: PASS.**
- [ ] **Step 5: Commit** `feat(ucmc-web): show site-feedback screenshots to their submitter and maintainers`.

### Task 8: Capturing the screenshot in the browser

**Files:**

- Modify: `apps/ucmc-web/package.json` (`"modern-screenshot": "4.7.0"`), `pnpm-lock.yaml`
- Create: `apps/ucmc-web/src/lib/capture-viewport.ts`
- Modify: `apps/ucmc-web/src/components/layouts/app-layout.tsx` (`captureScreenshot={surfaces.site}`, `capture={captureViewport}`)
- Modify: `apps/ucmc-web/src/features/site-feedback/components/site-feedback-form.tsx` (thumbnail + checkbox + `screenshotDataUrl`)
- Test: `apps/ucmc-web/src/lib/__tests__/capture-viewport.test.ts` (jsdom, `modern-screenshot` mocked), form tests

**Interfaces:**

- Consumes: `CapturedScreenshot` (Task 2), `SITE_FEEDBACK_SCREENSHOT_MAX_BYTES` (Task 6).
- Produces: `export async function captureViewport(opts?: { timeoutMs?: number; maxWidth?: number }): Promise<CapturedScreenshot | null>` (defaults 3000 / 1600).

- [ ] **Step 1: Write failing tests**: `returns webp when the browser encodes webp`; `falls back to jpeg when the webp result is not image/webp`; `retries jpeg at lower quality when over 1 048 576 bytes, then gives up with null`; `captureViewport resolves null on timeout` (fake timers; Review Focus 1); `resolves null when modern-screenshot throws`; `filters out Radix popper content and [data-feedback-capture-exclude]`. Form: `Include screenshot is checked by default for Bug and unchecked for Feature and General`; `once the member toggles it, switching kind keeps their choice`; `unticked, the submission carries no screenshotDataUrl` (Review Focus 3); `no screenshot in pageContext renders no checkbox`; helper text "Visible only to you and site maintainers. Never posted publicly."
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Install** `pnpm --filter ucmc-web add modern-screenshot@4.7.0 --save-exact`; confirm the lockfile resolves without quarantine or trust-policy errors.
- [ ] **Step 4: Implement `captureViewport`**: dynamic `import("modern-screenshot")`; capture `document.documentElement` clipped to the viewport (`width: innerWidth`, `height: innerHeight`, offset by `scrollX` / `scrollY`), `scale = Math.min(devicePixelRatio, maxWidth / innerWidth)`, `filter` dropping `[data-radix-popper-content-wrapper]` and `[data-feedback-capture-exclude]`; `domToWebp` at quality 0.8, fall back to `domToJpeg` 0.8, then 0.6; compute bytes from the base64 length; race against `timeoutMs`; any throw → `null`.
- [ ] **Step 5: Form UI**: extra form state `includeScreenshot` and `screenshotTouched`; until touched, `includeScreenshot` follows `kind === "bug"`. Thumbnail (`img` of `pageContext.screenshot.dataUrl`, click → full-size `Dialog`), checkbox "Include screenshot", helper text. `projectToVariant` adds `screenshotDataUrl` only when included.
- [ ] **Step 6: Run tests: PASS.** Manually: `pnpm --filter ucmc-web dev`, send a bug from `/gear`, confirm the thumbnail shows the page without the menu.
- [ ] **Step 7: Commit** `feat(ucmc-web): capture a screenshot automatically for site bug reports`.

### Task 9: Retention and orphan sweeps

**Files:**

- Create: `apps/ucmc-web/src/server/cron/screenshot-retention.ts` (pure)
- Modify: `apps/ucmc-web/src/server/cron/retention.server.ts` (module doc comment lists the new promise; `SweepCounts`; orchestrator)
- Modify: `apps/ucmc-web/stryker.config.json` (`mutate` gains the pure file)
- Test: `apps/ucmc-web/src/server/cron/__tests__/screenshot-retention.test.ts`, the existing retention test file

**Interfaces:**

- Produces:

  ```ts
  export const SCREENSHOT_RETENTION_DAYS = 30;
  export interface ScreenshotRetentionInput {
    status: string; // feedback.status
    statusChangedAt: Temporal.Instant | null;
    links: {
      state: "draft" | "filing" | "open" | "closed";
      closedAt: Temporal.Instant | null;
    }[];
  }
  export function resolvedAt(
    input: ScreenshotRetentionInput,
  ): Temporal.Instant | null;
  export function screenshotPurgeDue(
    input: ScreenshotRetentionInput,
    now: Temporal.Instant,
  ): boolean;
  // retention.server.ts
  export async function sweepResolvedSiteFeedbackScreenshots(
    now: Temporal.Instant,
  ): Promise<number>;
  // SweepCounts gains: resolvedScreenshots: number; orphanPrivateR2Keys: number;
  ```

- [ ] **Step 1: Write failing pure tests** pinning `resolvedAt`, which mirrors `siteFeedbackStateSql()`: non-draft links present → latest `closedAt` if every non-draft link is `closed` with a non-null `closedAt`, else `null`; only draft links → `null`; no links → `statusChangedAt` when status ∈ {`resolved`, `wont_fix`, `duplicate`, `closed`}, else `null`. `screenshotPurgeDue`: `due at exactly 30 days`, `not due at 30 days minus 1 ms`, `not due once reopened` (status `open`, old `statusChangedAt`; Review Focus 5), `not due when one of two issues is still open`, `not due with a null closedAt`, `not due for a legacy resolved row with null statusChangedAt`.
- [ ] **Step 2: Write failing sweep tests** (workers pool, private bucket): `deletes due screenshots in one batch, nulls screenshot_key and stamps screenshot_purged_at`; `leaves not-yet-due rows and objects alone`; `orphan sweep deletes an unreferenced site-feedback/screenshots/ object older than the age guard`; `orphan sweep keeps a referenced screenshot and a fresh unreferenced one`; `runRetentionSweeps reports resolvedScreenshots and orphanPrivateR2Keys`.
- [ ] **Step 3: Run both, expect FAIL.**
- [ ] **Step 4: Implement.** Pure module first. The sweep reads rows with non-null `screenshot_key` and their links joined to issues (link ids via `inSubquery`, never a bound list), filters with `screenshotPurgeDue`, calls `deleteSiteFeedbackScreenshots`, then one UPDATE with ids as `inJsonArray`. For orphans, factor the body of `sweepOrphanR2Keys` into a helper taking `(bucket, prefixes, loadLiveKeys, now, minOrphanAgeMs)` and add a private-bucket pass over `[SITE_FEEDBACK_SCREENSHOT_PREFIX]` whose live set is `feedback.screenshot_key`, keeping list-before-DB-read. Both new sweeps join the orchestrator's independent `try` list.
- [ ] **Step 5: Run tests: PASS.** `pnpm --filter ucmc-web test:mutation` is weekly, not required here; check the new file is in `mutate` and the mutation vitest config can load it (no `cloudflare:workers` import).
- [ ] **Step 6: Commit** `feat(ucmc-web): delete site-feedback screenshots 30 days after resolution`.

### Task 10: CORS on the public bucket

**Files:**

- Modify: `infra/cloudflare/index.ts`

**Interfaces:**

- Consumes: existing `publicBucket`, `hostname` config.

- [ ] **Step 1: Add** `new cloudflare.R2BucketCors(\`ucmc-web-${stack}-public-bucket-cors\`, { accountId, bucketName: publicBucket.name, rules: [{ allowed: { methods: ["GET", "HEAD"], origins: [\`https://${hostname}\`] }, maxAgeSeconds: 86400 }] })`with a comment saying why:`modern-screenshot`re-fetches images to inline them, and a response without CORS headers renders blank. Local dev serves images same-origin through`/api/*`, so it needs no origin here.
- [ ] **Step 2: Verify**: `pnpm --filter @ucmc/infra-cloudflare typecheck` passes, and run the `pulumi-reviewer` agent on the dev stack: the preview shows exactly one create (the CORS resource) and no replacement.
- [ ] **Step 3: Commit** `feat(infra-cloudflare): allow the app origin to read public R2 images with CORS`.

### Task 11: End-to-end, docs, final verification

**Files:**

- Create: `apps/ucmc-web/e2e/feedback-anywhere.spec.ts`
- Modify: `README.md` / `CLAUDE.md` only if a script, workflow or structure statement changed (expected: none)

- [ ] **Step 1: Write the e2e spec** following `site-feedback-triage.spec.ts`'s sign-in fixtures: a member on `/gear` opens the user menu, clicks "Send feedback…", picks Site (or lands on it), fills a bug, keeps "Include screenshot", submits; on `/my/feedback` the report shows and its thumbnail request returns 200 `image/webp` or `image/jpeg` with width ≤ 1600; the stored page path is `/gear` (assert via the triage view as a manager). A non-manager visiting `/feedback` ends on `/my/feedback`; the member's `/my/feedback` shows a Website section and not a Club one when they lack `club_feedback:submit` (or both, per the seeded role); a manager visiting `/feedback/site` ends on `/feedback/site/triage`; a site-only manager gets the 404 page at `/feedback/club`.
- [ ] **Step 2: Run** `pnpm --filter ucmc-web e2e -- e2e/feedback-anywhere.spec.ts` (in the devcontainer, per the host-e2e memory note): PASS.
- [ ] **Step 3: Run `pnpm verify`**: lint, typecheck, knip, `db:drift`, tests all green. Quote the summary in the PR body.
- [ ] **Step 4: Commit** `test(ucmc-web): e2e for sending feedback from any page`.
- [ ] **Step 5: Before opening the PR**, note in its body: prod deploy is blocked on the `/privacy` screenshot line (legal), and the compliance wiki needs a screenshot-handling note.
