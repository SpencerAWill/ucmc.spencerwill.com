---
paths:
  - "apps/ucmc-web/src/features/site-feedback/**"
  - "apps/ucmc-web/src/routes/feedback.site*"
---

# Site feedback (`/feedback/site`)

Bug / feature / general submissions aimed at the site maintainers. `site_feedback:submit` (auto-granted to `role_member`) lets a member send and see their own; `site_feedback:manage` unlocks triage. Gated by `pages.feedback_site`; the `site_feedback.submissions_enabled` feature setting pauses new submissions only (default ON, managers keep triage). The index page and the shared permission pairs are in `feedback-index.md`.

**A submission writes to D1 and nothing else.** `submitSiteFeedbackAction` only inserts: there is no submit-time GitHub mirror. Maintainers gather submissions into issue drafts and file them deliberately.

## Routes

| File                                       | URL                                |
| ------------------------------------------ | ---------------------------------- |
| `feedback.site.index.tsx`                  | `/feedback/site`: form + own list  |
| `feedback.site.triage.index.tsx`           | `/feedback/site/triage`: the inbox |
| `feedback.site.triage.issues.$issueId.tsx` | the composer, for drafts and filed |

Triage and the composer require `site_feedback:manage` through `requirePermission` (role emulation honoured). The page heading shows a "Triage (N)" link to managers, where N comes from `siteFeedbackOverviewQueryOptions`.

## Data: submissions and issues are many-to-many

- `siteFeedback` (SQL table **`feedback`**) holds submissions. Ids are `sfb_<uuidv7>`; rows from before the rename keep `fb_`.
- `site_feedback_issues` holds drafts and tracked issues (`sfi_<uuidv7>`; `state` is `draft` | `filing` | `open` | `closed`). `github_number` / `github_url` are null while a draft and unique once set. `updated_at` is the optimistic-concurrency token for draft edits.
- `site_feedback_issue_links` joins them. `quoted_md` is the editable report text; `posted_at` is null until that text has reached GitHub.
- `site_feedback_fts` is an FTS5 table over title and body, kept by triggers, behind the triage search and the "Possibly related" suggestions.
- `feedback.github_issue_number` / `github_issue_url` are dead columns: a migration copied them into links, nothing writes them, and dropping them is a later contract step.

**The SQL table stays `feedback`** even though the Drizzle export is `siteFeedback`. Migrations must only add (prod migrates later than dev and rollback is code-only), and renaming would cost a trigger and two releases for a name only operators see. Raw SQL (see `siteFeedbackStateSql`) therefore says `"feedback"`.

## Derived state, never stored

`siteFeedbackStateSql()` in `triage-repo.server.ts` computes a submission's `SiteFeedbackState` on read: linked to a non-draft issue, all closed is `resolved`, otherwise `tracked`; linked only to drafts is `in_draft`; unlinked falls back to the submission's own disposition (`status`: `open` reads as `new`, plus `wont_fix`, `duplicate`, `resolved`). Legacy `acknowledged` displays as New and legacy `closed` as Won't fix; they are **not rewritten**, because a backfill `UPDATE` would break rollback. Nothing stores the derived value, so a link change can never leave it stale.

**Submitters never see `in_draft`**: `toSummary` maps it to `new` and `trackedIn` lists filed issues only. The submitter card (`SiteFeedbackCard`) shows the state badge plus one "Tracked in #N" link per filed issue. There is no notification.

## Server

- Actions live in `site-feedback-actions.server.ts` (submit, own list, overview) and `site-feedback-triage-actions.server.ts` (everything a maintainer does); shells are `site-feedback-fns.ts` and `site-feedback-triage-fns.ts`. **Every triage action requires `site_feedback:manage`** via `requireSiteFeedbackManager`, tested per action.
- Caller-supplied id lists go through `inJsonArray` and multi-row writes through `insertMany` / `insertStatements`, so a 200-id bulk call (`SITE_FEEDBACK_BULK_MAX`) stays under D1's 100-parameter cap.
- Every mutation has its own `use-*.ts` hook, and its header states which of `siteFeedbackKeys.triageAll`, `.overview`, `.issue(id)`, `.related(id)` and `.mine` it invalidates. Hooks that touch an issue invalidate all of them; file and sync also invalidate `.mine`.
- Draft editing autosaves (`use-draft-autosave.ts`, about 1s debounce) and sends `expectedUpdatedAtMs`; a moved `updated_at` returns a conflict, which the editor shows and stops saving on.

## The GitHub client (`github.server.ts`)

- Config is `SITE_FEEDBACK_GITHUB_TOKEN` (fine-grained PAT, Issues read/write, a hand-managed secret) and `SITE_FEEDBACK_GITHUB_REPO` (a variable). Both are optional and read only inside `getGithubConfig()`, never at module scope. Neither is in Pulumi; see `infra.md`.
- **When either is unset, triage and drafting still work.** Filing, attaching and posting return `not_configured`, the composer's "File on GitHub" is disabled with "GitHub isn't configured, so filing is off.", and sync is a no-op. The UI learns this from `githubConfigured` in the payload. The e2e environment has no GitHub vars and asserts exactly this.
- Every non-2xx throws `GithubError`; the actions turn it into a surfaced `github_error` result rather than swallowing it.
- **Filing** (`fileSiteFeedbackIssueAction`) first claims the draft with a conditional `UPDATE ... state='filing'` (`claimIssueForFiling`), so two clicks cannot both file. A GitHub failure releases the claim and returns the draft to `draft` with the error shown. A row stuck in `filing` past `FILING_STALE_MS` (5 minutes) can be retried, and the retry calls `findIssueByMarker` for the hidden `<!-- ucmc:sfi_... -->` marker first and adopts any issue it finds instead of filing a duplicate.
- `attachSiteFeedbackToGithubIssueAction` validates a hand-made issue number with `getIssue` (pull requests are refused) before it links and posts; `postPendingSiteFeedbackReportsAction` posts one "Reports (N)" comment for the unposted links and then sets `posted_at`.

## Privacy

- **GitHub text attributes members by `users.publicId` only, never a name or email.** `issue-format.ts` builds it, and a test asserts no email or name reaches any GitHub payload. A quote carries kind, title, body, page path, a shortened user agent and the `publicId`.
- The page path was already stripped of query and fragment by `normalizePageUrl` at submit time, so tokens in a submitter's URL never reach triage or GitHub.
- **Maintainers can edit any quote before it is posted**, and filing confirms "This posts N reports publicly to `<repo>`".
- **Posted text is not re-synced.** Once a link has `posted_at`, its quote is read-only (`updateUnpostedQuote` / `deleteUnpostedLink` refuse it), and editing in the app never changes GitHub. The UI says so. Do not add a path that rewrites a posted comment.

## Sync and the cron budget

`syncSiteFeedbackIssues` asks GitHub, in one GraphQL request with aliased `issue(number:)` lookups (chunked at 100), which tracked `open` issues are still open, and mirrors `closed` into `site_feedback_issues` along with `github_synced_at`. A null issue (deleted or transferred) counts as closed. It is one request, not one REST call per issue, because Workers Free caps an invocation at 50 subrequests. A closed issue that is reopened on GitHub is not noticed.

**Sync adds no cron expression.** It rides the existing `0 12 * * *` daily tick (`runSiteFeedbackIssueSync` from `server-entry.ts`), plus the manager's "Sync now" button. Workers Free allows 5 cron expressions per account, each stack costs two (dev and prod), and 4 are already used, so an hourly schedule is not available. Filing and attaching record the issue's state when they happen, which is why daily is enough. `runSiteFeedbackIssueSync` logs `site_feedback.sync_failed` and returns; **it must never throw into the daily tick**, where it would take the retention sweeps down with it.

## Naming

Internal identifiers say which feedback they mean: `siteFeedback`, `SiteFeedbackSummary`, `SITE_FEEDBACK_*`, `*SiteFeedbackAction`, `siteFeedbackKeys`, `site_feedback.*` log events, `checkSiteFeedbackRateLimit`. A bare "feedback" is reserved for things spanning both surfaces (`/feedback`, `pages.feedback`, `feedback.tsx`).
