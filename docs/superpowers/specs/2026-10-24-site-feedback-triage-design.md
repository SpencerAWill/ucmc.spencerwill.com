# Site-feedback triage and GitHub issue drafting

Status: approved design, 2026-10-24. Implementation plan to follow.

## Goals

1. **Explicit naming.** Internal identifiers say _which_ feedback they are. A bare "feedback" today silently means site feedback; after this change it only names things that genuinely span both surfaces.
2. **`/feedback` becomes an index page** of two cards (Club, Site) instead of a redirect plus a segmented switch.
3. **No automatic GitHub issues.** A site-feedback submission writes to D1 and nothing else. Maintainers (`site_feedback:manage`) triage submissions in the app, gather related ones into saved issue drafts, and file a draft to GitHub when ready, with every linked submission included. Submissions and issues are many-to-many.

## Decisions

| Question                    | Decision                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| How an issue reaches GitHub | The app creates it via the GitHub API with the existing (renamed) PAT and records the number and URL                                                                                                                                                               |
| Link scope                  | Submissions attach to new drafts, app-filed issues, or hand-made GitHub issues by number. One submission may link to several issues                                                                                                                                |
| Drafts                      | Saved DB rows, shared among all managers, built up over time                                                                                                                                                                                                       |
| Issue state sync            | Daily, on the existing `0 12 * * *` tick, plus on every file/attach and a "Sync now" button. **Not hourly**: the Workers Free plan allows 5 cron expressions, each costs two (dev + prod), and 4 are already in use                                                |
| Issue body                  | The maintainer's summary, then an editable, prefilled "Reports (N)" section with one `<details>` per submission, attributed by `publicId` only                                                                                                                     |
| Finding related submissions | Manual selection, plus "Possibly related" suggestions from FTS5 on the draft's title and summary, and same page path                                                                                                                                               |
| Submitter view              | Derived status and "Tracked in #N" links. **No notification**                                                                                                                                                                                                      |
| Triage layout               | Inbox with checkboxes and a selection toolbar, plus a right rail of drafts and filed issues (mockup option A)                                                                                                                                                      |
| Composer                    | Its own page, `/feedback/site/triage/issues/$issueId`, serving both drafts and filed issues                                                                                                                                                                        |
| Index                       | Two descriptive cards with a role-aware footer (counts, plus a Triage/Review link for managers)                                                                                                                                                                    |
| The D1 table `feedback`     | **Keep the SQL name.** `export const siteFeedback = sqliteTable("feedback", …)` with a comment. Migrations must only add (prod migrates later than dev, rollback is code-only), and the alternatives cost a trigger and two releases for a name only operators see |

## Naming

| Today                                                                  | Becomes                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/feedback/`                                               | `src/features/site-feedback/`                                                                                                                                                      |
| Drizzle `feedback`, `FeedbackSummary`, `FEEDBACK_*`, `*FeedbackAction` | `siteFeedback`, `SiteFeedbackSummary`, `SITE_FEEDBACK_*`, `*SiteFeedbackAction`                                                                                                    |
| `useSubmitFeedback`, `FeedbackCard`, `FeedbackForm`, query keys        | `useSubmitSiteFeedback`, `SiteFeedbackCard`, `SiteFeedbackForm`, `siteFeedbackKeys`                                                                                                |
| `fb_` id prefix (new rows)                                             | `sfb_` (existing ids are untouched)                                                                                                                                                |
| `feedback.*` log events                                                | `site_feedback.*`                                                                                                                                                                  |
| `checkFeedbackRateLimit`                                               | `checkSiteFeedbackRateLimit`                                                                                                                                                       |
| settings `feedback.site_enabled` / `feedback.club_enabled`             | `site_feedback.submissions_enabled` / `club_feedback.submissions_enabled` (settings keys are namespaced by area, as `calendar.*` is), via the `rename-permission-or-setting` skill |
| env `FEEDBACK_GITHUB_TOKEN` / `FEEDBACK_GITHUB_REPO`                   | `SITE_FEEDBACK_GITHUB_TOKEN` / `SITE_FEEDBACK_GITHUB_REPO`                                                                                                                         |

These stay "feedback" because they name both surfaces: the `/feedback` URL area, `pages.feedback`, the `feedback.tsx` layout and the index route. The permissions are already `site_feedback:*` / `club_feedback:*`. The SQL table `feedback` and its indexes also keep their names (see Decisions).

## Data model

All migrations go through `drizzle-kit generate`, with `--custom` for FTS, triggers and backfills. All of them only add.

### `feedback` (Drizzle `siteFeedback`)

- The `status` enum gains `wont_fix` and `duplicate`. The column now holds the submission's own **disposition**: `open`, `wont_fix`, `duplicate`, `resolved`. Legacy `acknowledged` displays as New and legacy `closed` as Won't fix. They are not rewritten, because a backfill `UPDATE` would break rollback.
- `github_issue_number` / `github_issue_url` become dead: a migration copies them into links, and nothing writes them afterwards. Dropping them is a later contract step.

### `site_feedback_issues`

One row per draft or tracked issue.

| Column                                  | Notes                                                      |
| --------------------------------------- | ---------------------------------------------------------- |
| `id`                                    | `sfi_<uuidv7>`                                             |
| `state`                                 | `draft` \| `filing` \| `open` \| `closed`                  |
| `title`, `summary_md`, `labels` (JSON)  | `summary_md` is null for an attached hand-made issue       |
| `github_number`, `github_url`           | null while a draft; unique when set                        |
| `github_synced_at`, `filing_started_at` |                                                            |
| `created_by`, `filed_by`, `filed_at`    | FKs `set null` on user delete                              |
| `created_at`, `updated_at`              | `updated_at` is the optimistic-concurrency token for edits |

### `site_feedback_issue_links`

| Column                    | Notes                                                                     |
| ------------------------- | ------------------------------------------------------------------------- |
| `issue_id`, `feedback_id` | composite PK, both FKs `cascade`                                          |
| `quoted_md`               | the editable report text, prefilled from the submission                   |
| `posted_at`               | null until the report has reached GitHub (in the issue body or a comment) |
| `added_by`, `added_at`    |                                                                           |

The backfill creates one `open` issue row per distinct legacy `github_issue_number`, plus a link with `posted_at = created_at`.

### `site_feedback_fts`

An FTS5 table over the submission title and body, kept in sync by triggers, following `drizzle/migrations/0081_search_fts.sql` and `src/server/db/search.ts`.

### Derived submission state

Computed in SQL on read:

- linked to at least one non-draft issue, and all of them `closed` → **Resolved**
- linked to at least one non-draft issue, any of them not closed → **Tracked**
- linked only to drafts → **In draft** (shown to managers; submitters see **New**)
- not linked → the disposition: **New** / **Won't fix** / **Duplicate** / **Resolved**

## Server

`features/site-feedback/server/`: `site-feedback-triage-actions.server.ts`, shell `site-feedback-triage-fns.ts` (one-line handlers that dynamic-import the actions), and a rewritten `github.server.ts`.

- Every triage action requires `site_feedback:manage`.
- Lists from the caller go through `inJsonArray`; multi-row writes go through `insertMany`.
- `submitSiteFeedbackAction` only inserts.

| Action                                                                              | Behaviour                                                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `listSiteFeedbackTriage({ view, q })`                                               | `view`: `new` \| `in_draft` \| `tracked` \| `closed`; `q` searches via FTS                       |
| `setSiteFeedbackDisposition({ ids, disposition })`                                  | bulk                                                                                             |
| `createSiteFeedbackIssueDraft({ feedbackIds })`                                     | title defaults to the first submission's; each `quoted_md` is generated                          |
| `updateSiteFeedbackIssueDraft({ id, title, summaryMd, labels, expectedUpdatedAt })` | returns `conflict` when `updated_at` has moved                                                   |
| `linkSiteFeedback` / `unlinkSiteFeedback` / `updateSiteFeedbackQuote`               | on a filed issue, new links get `posted_at = null`; quotes that are already posted are read-only |
| `attachSiteFeedbackToGithubIssue({ number, feedbackIds })`                          | `getIssue` validates the number; creates or reuses the issue row, links, then posts              |
| `postPendingSiteFeedbackReports({ issueId })`                                       | one "Reports (N)" comment covering unposted links, then sets `posted_at`                         |
| `fileSiteFeedbackIssue({ id })`                                                     | see Filing                                                                                       |
| `listRelatedSiteFeedback({ issueId })`                                              | up to 10 unlinked, undisposed submissions: FTS on title + summary, union same `page_url` path    |
| `syncSiteFeedbackIssues()`                                                          | also called from the daily tick                                                                  |
| `getSiteFeedbackOverview()`                                                         | `{ mineTracked, mineOpen, untriaged? }`; `untriaged` only computed for managers                  |

`features/club-feedback` gains `getClubFeedbackOverview()` → `{ mineOpen, newForOfficers? }`, counts only.

### Filing

1. Claim the draft: `UPDATE … SET state='filing', filing_started_at=now WHERE id=? AND state='draft'`. If no row changed, return "already being filed".
2. The body is the summary, then "Reports (N)", then a footer and a hidden `<!-- ucmc:sfi_… -->` marker. Labels come from the draft; the defaults are derived from the linked kinds (`bug` / `enhancement`, plus `feedback`).
3. On success: store the number and URL, set `state='open'`, `filed_*`, and `posted_at` on every link.
4. On a GitHub error: return the draft to `draft` and **surface the error** to the maintainer.
5. A row stuck in `filing` for more than 5 minutes can be retried. The retry searches the repo for the marker first and adopts any issue it finds, rather than filing a duplicate.

### Sync

- One GraphQL request with aliased `issue(number:)` lookups covers every tracked issue that isn't closed, chunked at 100 per request. Workers Free caps each invocation at 50 subrequests, so it can't be one REST call per issue.
- Updates `state` and `github_synced_at`. A null issue (deleted or transferred) becomes `closed`.
- Logs and returns on failure; it never throws into the daily tick.

### GitHub config

- `SITE_FEEDBACK_GITHUB_TOKEN` (fine-grained PAT, Issues read/write) and `SITE_FEEDBACK_GITHUB_REPO` stay optional.
- When either is unset: triage and drafting work, filing, attaching and posting are disabled with an explanation, and sync is a no-op.
- The UI learns availability from a boolean in the triage payload.

### Privacy

- The generated `quoted_md` carries kind, title, body, page path (already query- and fragment-stripped by `normalizePageUrl`), the user agent and `publicId`. Never a name or email.
- The maintainer can edit any quote before it's posted.
- Filing confirms "This posts N reports publicly to `<repo>`".
- Posted text isn't re-synced: editing in the app after posting doesn't change GitHub, and the UI says so.

## Routes and UI

The pathless `_tabs` layout is removed. `/feedback/club` and `/feedback/site` keep their URLs.

| File                                       | URL                                  | Gate                                                                |
| ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------- |
| `feedback.tsx`                             | layout: `PageContainer` + breadcrumb | `requireApproved`                                                   |
| `feedback.index.tsx`                       | `/feedback`, the cards               | `pages.feedback`; `notFound` only when neither surface is reachable |
| `feedback.club.tsx`                        | `/feedback/club`                     | `pages.feedback_club` + `CLUB_FEEDBACK_PERMISSIONS`                 |
| `feedback.site.index.tsx`                  | `/feedback/site`                     | `pages.feedback_site` + `SITE_FEEDBACK_PERMISSIONS`                 |
| `feedback.site.triage.index.tsx`           | `/feedback/site/triage`              | `pages.feedback_site` + `site_feedback:manage`                      |
| `feedback.site.triage.issues.$issueId.tsx` | composer                             | as triage                                                           |

- The sibling-redirect fallbacks are deleted, and an unreachable surface returns `notFound`. Permission checks in routes read `effectivePermissionsFor` / `hasPermission`, so role emulation is honoured.
- **Sidebar** (`app-layout.tsx`): one entry targeting `/feedback`, gated on `pages.feedback` plus either permission pair. `feedbackTarget` is removed.
- **Removed:** `components/layouts/feedback-tabs-bar.tsx`, its test, `getFeedbackTabSubtitle`.
- **Index cards:** Club first. Each card has an icon, title, audience, what to send, the primary link, and a footer of badges (the viewer's own count, and the manager count when `hasPermission` grants manage) with a Triage/Review link. A viewer who can reach one surface sees one card.
- **Sub-pages:** a breadcrumb (`Feedback › Site`), the page's own heading and subtitle, and a "Triage (N) →" link on the heading row for managers.
- **Triage page:**
  - View chips and FTS search.
  - Checkbox rows showing kind, path, browser and age.
  - A sticky selection toolbar: + New draft, Add to… (a combobox of drafts and open issues, plus "GitHub issue #…"), Won't fix, Duplicate.
  - A rail with Drafts and Filed (open) plus report counts, Sync now, and "last synced …".
  - On narrow screens the rail stacks above the list and collapses.
- **Composer, draft:**
  - Title, labels, and the summary with a Write/Preview toggle (preview via `components/markdown/markdown-content.tsx`).
  - The Reports list, each with Edit text and Unlink.
  - A "Possibly related" column with + Add, and search.
  - File on GitHub (confirm dialog), and Delete draft.
  - Debounced autosave (~1s) with saved and conflict states.
- **Composer, filed:** a read-only header linking to GitHub with its state, the posted reports, any unposted reports with "Post N new reports", and Possibly related.
- **Submitter card** (`SiteFeedbackCard`): a derived-state badge, plus "Tracked in #N" for each filed linked issue. Drafts are never shown to submitters.
- **Hooks:** one `use-*.ts` per mutation. Every hook invalidates `siteFeedbackKeys.triage` and `.overview`. Hooks that touch an issue also invalidate `.issue(id)` and `.related(id)`; file and sync also invalidate `.mine`. Each hook's header comment states its contract.
- **Copy:** the setting descriptions lose the "GitHub mirror still fires" clause. The site form says submissions are "read by the site maintainers".

## Rollout

Three PRs, each commit green and independently revertable.

**PR 1 — rename**

1. Remove the submit-time GitHub mirror and its tests.
2. Rename the feature directory and its identifiers.
3. Run the settings-key rename migration via the skill.
4. Rename the env vars across `cloudflare-env.ts`, `.github/actions/deploy`, `cicd.yml`, the `infra/github` comment, README and `CLAUDE.md`. The maintainer re-enters the secret and variable under the new names before PR 3. Until then nothing reads them.

**PR 2 — index**

Cards page, `_tabs` removal, breadcrumb, sidebar target, overview queries, regenerated `routeTree.gen.ts`.

**PR 3 — triage**

1. Schema, migrations, FTS, backfill.
2. GitHub client and actions.
3. Daily sync and Sync now.
4. Triage page and hooks.
5. Composer page.
6. Submitter card state.

## Testing

**Workers pool:**

- The manage-permission refusal on every triage action.
- The derived-state SQL, one fixture per state.
- Bulk disposition with 150 ids (within the D1 parameter limit).
- Filing claim exclusivity, failure rollback, and stuck-`filing` recovery via the marker (stubbed `fetch`).
- `posted_at` is set exactly once.
- The GraphQL sync parser, including null issues.
- A sync failure doesn't throw.
- Related-suggestion ranking.
- No email or name in any GitHub payload.
- A `migration-upgrade` test for the backfill over rows in the old shape.

**jsdom:**

- The state badge and links.
- The selection toolbar.
- The composer conflict banner.
- The index cards by permission, including under role emulation.

**E2E:** select two submissions → create a draft → edit it → it appears in the rail. GitHub env unset, so the spec also asserts the disabled-filing explanation.

**Gates:** `pnpm verify`, plus mutation-checking the new tests before each PR.

## Docs and rules

- Split `.claude/rules/feature-feedback.md` into:
  - `feedback-index.md`: routes, cards, counts.
  - `feature-site-feedback.md`: triage, derived state, GitHub client, privacy, the cron-budget constraint, why the SQL table name stays.
  - `feature-club-feedback.md`: club feedback as it is today.
  - Each with narrow `paths`.
- README and `CLAUDE.md` for the env rename.
- `knip.config.ts` only if a new entry point needs it.
- No legal or privacy copy references GitHub or feedback, and the compliance wiki is unaffected.

## Out of scope

- AI clustering.
- Webhooks.
- Submitter notifications.
- Dropping the dead `github_issue_*` columns (a later contract step).
- Syncing titles or labels back from GitHub.
- Editing reports after they're posted.
- Club-feedback changes beyond the rename and its overview count.
