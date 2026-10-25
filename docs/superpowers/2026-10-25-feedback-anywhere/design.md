# Feedback from anywhere, automatic screenshots, and `/my/feedback`

Status: approved design, 2026-10-25. Implementation plan to follow.

## Goals

1. **Send feedback from any page.** A signed-in, approved member opens a modal from the user menu, picks Club or Site, and fills in that surface's existing form. The captured page URL then means something, because it is the page the member was on rather than `/feedback/site`.
2. **Automatic screenshots for site feedback.** The page is captured as the modal opens and attached to the report unless the member opts out. Nothing to upload.
3. **`/my/feedback`.** A member's own site and club submissions in one place, linked from the user menu.
4. **`/feedback` becomes manager-only.** The area and its sub-pages serve `site_feedback:manage` (triage) and `club_feedback:manage` (review). Submission and "my submissions" leave it.

Feedback stays authenticated-only: the entry point is the user menu, which anonymous visitors don't have.

## Decisions

| Question                       | Decision                                                                                                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry point                    | The user menu only, as **one row holding two side-by-side items**: "Send feedback…" (opens the modal) and "My feedback" (links to `/my/feedback`)                                                                                                          |
| How the menu reaches the modal | A feature-agnostic launcher context in `src/components/feedback/` (`useFeedbackLauncher()`), provided by `AppLayout`, which also mounts the dialog. Leaves room for a "Report this" button on `RouteErrorFallback` later (out of scope)                    |
| Modal flow                     | Step 1 picks Club or Site, as the `/feedback` cards do today; step 2 is that surface's existing form. Step 1 is skipped when only one surface is available                                                                                                 |
| Screenshot technique           | DOM rasterisation with `modern-screenshot`, lazy-imported inside `open()`. No permission prompt, works on mobile. `getDisplayMedia` was rejected: it prompts on every use and mostly doesn't exist on phones                                               |
| When the screenshot is taken   | When the menu item is clicked, after the menu closes and **before the modal renders**, so the image shows the page and not the form                                                                                                                        |
| Which surfaces capture context | **Site only.** Club feedback gets no page URL, user agent or screenshot: it is about governance, not a page, and has an anonymous mode that a URL or an image could undermine                                                                              |
| Who can see a screenshot       | The submitter and `site_feedback:manage` holders only. Private R2 bucket, served through a permission-checked Worker route                                                                                                                                 |
| Screenshots and GitHub         | **Never posted**, not even by a deliberate maintainer action. GitHub's API can't attach an image to an issue, so posting one would mean hosting it publicly, which defeats the private bucket. The quote says a screenshot exists and is visible in triage |
| Screenshot retention           | **Deleted 30 days after the report resolves** (Won't fix, Duplicate, Resolved, or all linked filed issues closed). Rides the existing daily `0 12 * * *` tick                                                                                              |
| `/feedback` for non-managers   | Redirect to `/my/feedback` (or 404 when `pages.my_feedback` is off), so old bookmarks land somewhere useful                                                                                                                                                |
| `/feedback/site`               | Redirects to `/feedback/site/triage`, keeping triage and composer URLs stable                                                                                                                                                                              |
| `/my/feedback` layout          | Two stacked sections, Website and Club, rather than tabs or one merged timeline: the two card shapes differ and members have few of each                                                                                                                   |

## The launcher and the modal

### `useFeedbackLauncher`

`src/components/feedback/feedback-launcher.tsx` exports a context provider and `useFeedbackLauncher(): { open(): void; canSend: boolean }`. It knows nothing about either feature. With no provider mounted, `canSend` is `false` and `open` is a no-op, so `UserMenu` renders in tests and Storybook without wiring.

`AppLayout` (`components/layouts/`, which `eslint.config.js` already lets compose features) provides the context and mounts `<FeedbackDialog>`, which composes `features/site-feedback` and `features/club-feedback`. The dialog computes which surfaces are available and feeds `canSend`:

| Surface | Available when                                                                  |
| ------- | ------------------------------------------------------------------------------- |
| Site    | `hasPermission("site_feedback:submit")` and `site_feedback.submissions_enabled` |
| Club    | `hasPermission("club_feedback:submit")` and `club_feedback.submissions_enabled` |

Permission checks use `hasPermission`, so role emulation is honoured.

### The user-menu row

For approved members, after "My Cart": one flex row with two `DropdownMenuItem`s, `[💬 Send feedback…] [My feedback →]`. Both stay real menu items, so arrow-key navigation reaches them in DOM order. Either half hides when its gate is off and the other fills the row; the row disappears when both are off.

| Half          | Gate                                                       |
| ------------- | ---------------------------------------------------------- |
| Send feedback | `canSend` from the launcher                                |
| My feedback   | `pages.my_feedback` and either surface's submit permission |

### `open()`

1. Close the menu and wait one animation frame, so the dropdown isn't in the capture.
2. If Site is available: capture with `modern-screenshot`, scaled to at most 1600 px wide, encoded WebP (falling back to JPEG where the browser can't encode WebP), targeting about 200–400 KB, with a **3 s timeout**. Failure or timeout opens the modal without a screenshot; it never blocks feedback.
3. Record `pageUrl` (`window.location.href`) and `userAgent` at this moment and open the modal with them.

### The dialog

- **Step 1, choose:** Club or Site cards, mirroring the current `/feedback` index copy. Skipped when one surface is available.
- **Step 2, Site:** today's `SiteFeedbackForm` (Bug / Feature / General). Below the fields, a thumbnail with an **"Include screenshot"** checkbox, **on by default for Bug and off for Feature and General**. Clicking the thumbnail opens it full size so the member can see what they are sharing. Helper text: "Visible only to you and site maintainers. Never posted publicly." `pageUrl` and `userAgent` come from `open()`, not from `window.location` at submit time.
- **Step 2, Club:** today's `ClubFeedbackForm` unchanged, anonymous toggle included. The captured screenshot is discarded, never uploaded, and no URL is attached.
- A Back button returns to step 1. On success: close, toast "Thanks — see it in My feedback", and the submit hooks invalidate `.mine` (and `.overview`) as they do today.
- `Dialog` at desktop widths, full-height sheet on phones.

## Screenshot pipeline

### Storage and dependency

- The private bucket (`getPrivateBucket()`), its first user. Key: `site-feedback/screenshots/<sfb_id>.webp` (or `.jpg`). One screenshot per report.
- `modern-screenshot` as a new dependency, exact version at least 7 days old (`dependencies.md`), only imported dynamically from `open()`.
- **Pulumi:** a CORS rule on the public R2 bucket allowing `GET` from the app's origins (dev, prod, local dev). `modern-screenshot` re-fetches every image to inline it, and today `cdn.*` sends no CORS headers, so avatars and landing images would render blank.

### Data (one add-only migration via `db:generate`)

| Table                  | New column             | Meaning                                                                |
| ---------------------- | ---------------------- | ---------------------------------------------------------------------- |
| `feedback`             | `screenshot_key`       | R2 key, null when there is none or it has been purged                  |
| `feedback`             | `screenshot_bytes`     | Size, for display and auditing                                         |
| `feedback`             | `screenshot_purged_at` | When the retention sweep deleted it                                    |
| `feedback`             | `status_changed_at`    | Stamped by Won't fix, Duplicate and Reopen                             |
| `site_feedback_issues` | `closed_at`            | Stamped wherever an issue's `state` becomes `closed` (sync and attach) |

**Resolution time** is a pure function in `features/site-feedback/lib/` (mutation-testable, in the shape of `gear/lib/loan-reminders.ts`): for a report linked to non-draft issues, it is the latest `closed_at` once all of them are closed; for an unlinked report with a resolving disposition, it is `status_changed_at`; otherwise there is none. A null timestamp yields no resolution time, so the row isn't swept, the same NULL-skip discipline as the existing sweeps. Rows from before the migration have no screenshots, so nothing is lost by skipping them.

The derived state itself is still never stored (`feature-site-feedback.md`); these are transition timestamps.

### Submit

- `siteFeedbackInputSchema` gains an optional `screenshotDataUrl`, the same wire shape as avatar upload (`avatar-actions.server.ts`).
- Server checks: `image/webp` or `image/jpeg` only, magic bytes match the declared type, **1 MB maximum** decoded, and `checkUploadRateLimit`.
- Write order: `put` to R2, then insert the row with `screenshot_key`. If the insert fails, delete the object (best effort). A Worker that dies between the two leaves an orphan, which the orphan sweep (below) collects.
- `site_feedback.submissions_enabled` off refuses the whole submission as today.

### Viewing

- A server route, `GET /api/site-feedback/:id/screenshot`, streams the object to the report's submitter or a holder of `site_feedback:manage` (via `effectivePermissionsFor`, so a manager emulating a member role is refused). Everyone else, including a missing or purged screenshot, gets a 404.
- Headers: `Content-Type` from the stored type, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`.
- Shown as a thumbnail on the submitter's `SiteFeedbackCard` in `/my/feedback`, on the triage card and in the composer; click for full size. After purging, those places say "Screenshot deleted 30 days after resolution."
- The site summary and triage payloads gain `screenshot: "present" | "purged" | null`. The R2 key never reaches the client.

### GitHub

`quotedReportFor` adds the line "Screenshot attached (visible in triage)." when a report has one, with no URL. A test beside the existing no-email/no-name assertion checks that no screenshot key or route appears in any GitHub payload.

### Retention

- **New sweep in `retention.server.ts`**: reports with a non-null `screenshot_key` whose resolution time is more than 30 days ago. Delete the objects in one batched `bucket.delete(keys)` (up to 1000 keys per call, well inside the 50-subrequest Workers Free budget), then null `screenshot_key` and stamp `screenshot_purged_at`. Independent of the other sweeps, like them; failures are logged and don't stop the tick.
- **Orphan sweep**: the existing unreferenced-object GC (public bucket today) also lists the private `site-feedback/screenshots/` prefix, keeping its list-before-reading-the-DB discipline.

## `/feedback` for managers only

- **`feedback.tsx`**: after `requireEnabledPages` and `requireApproved`, the viewer must hold `site_feedback:manage` or `club_feedback:manage` (`effectivePermissionsFor`). Otherwise redirect to `/my/feedback`, or 404 when `pages.my_feedback` is off.
- **The index** keeps its two cards for managers only: Site → Triage (N new), Club → Review (N new). Each follows its own `canManage*` boolean, as now. The "mine" counts leave the cards.
- **`/feedback/site`** (`feedback.site.index.tsx`) loses the form and the own list and redirects to `/feedback/site/triage`.
- **`/feedback/club`** keeps the officer review list and loses the form and the own list.
- A manager of one surface who opens the other gets a 404.
- **Sidebar**: "Feedback" shows when `pages.feedback` is on and the viewer manages at least one reachable surface.
- **`CLUB_FEEDBACK_PERMISSIONS` / `SITE_FEEDBACK_PERMISSIONS`** (`features/auth/guards.ts`) stop meaning "reachable": reaching a surface is now its manage permission alone, and submit gates the modal and `/my/feedback`.
- **Settings descriptions** for `pages.feedback`, `pages.feedback_site`, `pages.feedback_club` and both `*.submissions_enabled` are reworded: page flags hide the manager pages; the submission switches hide that surface in the modal and make its endpoint refuse.

## `/my/feedback`

- `routes/my.feedback.tsx`, a direct sibling of `/my/gear` outside the `_tabs` chrome. `/my` already runs `requireApproved` and the page-flag walk.
- New page flag **`pages.my_feedback`** (parent `my`, default on): a registry entry, no migration, wired the way the `add-page-flag` skill describes.
- Header "My feedback" with a "Send feedback…" button that calls the launcher.
- Two stacked sections, each shown when the viewer holds that surface's submit permission:
  - **Website**: `SiteFeedbackCard` (state badge, "Tracked in #N" links), plus the screenshot thumbnail or the purged note.
  - **Club**: the member's own club rows, un-redacted to their owner.
  - Newest first; an empty section reads "Nothing yet" with a "Send feedback…" action.
- Data: the existing `.mine` queries for both surfaces. No new server actions besides the `screenshot` field on the site summary.
- 404 when the viewer holds neither submit permission.
- The route composes both features; nothing is hoisted out of `src/features/`.

## Delivery

Members must always have a way to submit, so the forms leave `/feedback` only once the modal exists. Three PRs, each green and independently revertable, with sequenced commits inside each:

1. **`/my/feedback`**: route, flag, the menu row with its "My feedback" half, empty states. Purely additive.
2. **Feedback from anywhere, `/feedback` manager-only**: launcher, dialog and the "Send feedback…" half; page context captured at open; then removal of forms and own lists from `/feedback/*`, the guard and redirects, the sidebar gate, the permission constants, settings descriptions and rule files.
3. **Screenshots**: migration, timestamp stamping, submit and R2 write, screenshot route, thumbnails, retention and orphan sweeps, Pulumi CORS, the `modern-screenshot` dependency.

### Blocked before PR 3 reaches prod

**The `/privacy` notice needs a line about screenshots and their 30-day retention.** That copy is legal review and must match the canonical PDF (`src/config/legal.ts`), so this design does not word it. The retention sweep lands in PR 3 regardless; the notice update is the owner's to supply.

## Testing

- **Workers pool**: submit with a screenshot (type, magic bytes, 1 MB cap, rate limit, R2-before-row ordering, cleanup on insert failure); the screenshot route (owner yes, manager yes, other member 404, emulating manager 404, purged 404); `status_changed_at` and `closed_at` stamping; the retention sweep (30-day boundary, NULL skip, multi-issue reports needing all closed, one batched delete); the private-prefix orphan sweep; no screenshot key or route in any GitHub payload.
- **Pure lib**: the resolution-time function, covered by Stryker.
- **jsdom**: `useFeedbackLauncher` without a provider; the user-menu row's gate matrix (each half alone, both, neither); the dialog (chooser skipped with one surface, Back, screenshot discarded on Club, checkbox default per kind, opening without a screenshot when capture fails); `/feedback` guard redirects; index cards following the manage booleans.
- **e2e**: a member on `/gear` sends a site bug from the menu and finds it in `/my/feedback` with page `/gear` and a thumbnail; a non-manager visiting `/feedback` lands on `/my/feedback`.
- `knip` entries where a new entry point needs one, the mutation-hook contract test, and `pnpm verify` green per PR.

## Rules and docs to update with the code

`feedback-index.md`, `feature-site-feedback.md`, `feature-club-feedback.md`, `auth/core.md` (the `/my/*` list), `app-chrome.md` if the sidebar gate wording changes, `data/r2.md` for the first private-bucket user, and the retention comment block in `retention.server.ts`. The compliance wiki gets a note on screenshot handling once PR 3 ships.

## Out of scope

Redaction tools for screenshots, multiple attachments per report, screenshots for club feedback, a "Report this" button on the error page (the launcher makes it a small follow-up), and anonymous feedback.
