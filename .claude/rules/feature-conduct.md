---
paths:
  - "apps/ucmc-web/src/features/conduct/**"
  - "apps/ucmc-web/src/server/conduct/**"
  - "apps/ucmc-web/src/routes/conduct*.tsx"
---

# Member conduct records

Why records outlive the account, why the block is a keyed hash, and the retention windows: `docs/adr/0012-conduct-records-outlive-the-account.md`. This file is the rules for changing it.

## Where things go

- **`src/server/conduct/`**: `standing.server.ts` (the one standing predicate) and `retention.ts`. Anything `features/auth`, `features/members` or `features/trips` needs from conduct lives here, because features may not import each other.
- **`features/conduct/server/`**: `record-repo.server.ts` (queries), `record-actions.server.ts` (logic and guards), `record-fns.ts` (one-line `createServerFn` shells), `limits.ts` (Zod schemas and labels).
- **`features/conduct/`**: `/conduct` (records list and detail) and `components/member-conduct-card.tsx`. `routes/members.$publicId.tsx` composes the card; the route may import both features, the features may not import each other.
- **Reports**: members file from the user menu ("Report a conduct concern", `components/report-dialog.tsx`, mounted lazily by `AppLayout` through `components/feedback/conduct-report-launcher.tsx` because `features/auth` cannot import this feature). It shows only when `hasPermission("conduct:report")` and `getPublicFlagsFn().conductReports` (`conduct_reports.submissions_enabled`) hold. The member picker is `searchReportSubjectsFn` (`conduct:report`, public ids and names only, 10 results); **never reuse `searchConductSubjectsFn` there, it returns internal ids.** `/conduct/reports` (`reports-table.tsx`, `triage-actions.tsx`) is the triage list; `/conduct` redirects to it for `conduct:manage` holders and to records otherwise. "Start a record" is `RecordForm` prefilled with the report's subject and `reportIds`.
- **Manager notice**: submitting emails every approved `conduct:manage` holder (or `system_admin`) with a verified primary email and `conduct.report_received` on, except the reporter and the subject, after the batch commits (`notifyManagers`). A failure is logged and never fails the submission. The email (`server/email/conduct-email.ts`) carries a link and no report text.
- **Subject notice**: a warning, suspension or termination emails the subject (`conduct.notice`, not suppressible, so no preference is read) after the batch commits, to their primary verified address; `lift` sends a "lifted" notice with no internal reason. `sendNotice` never throws: no address or a failed send leaves `notice_sent_at` NULL ("Notice not sent" on the detail page). Setting it is what locks the statement (updates are `internalNotes` only). `previewConductNoticeAction` calls the same `conductNoticeEmail`; `RecordForm`'s confirm step fetches it through `previewConductNoticeFn` (POST, so the statement stays out of URLs) and shows the exact subject and text, with issuing disabled while it loads or if it fails. A note has no preview.
- **`/my` card**: `components/my-conduct-card.tsx`, composed by the `/my/_tabs` layout (`my.index.tsx` is only a redirect, so the card lives where it lands and shows on every account tab). `getMyActiveSanctionsAction` (`my-conduct-actions.server.ts`) needs a session and no conduct permission, and returns the caller's own unlifted warnings, suspensions and terminations (a warning or suspension also needs `ends_on` NULL or not past, in `CLUB_TIME_ZONE`; an upcoming one shows) as `{level, statement, startsOn, endsOn}` only. A record whose notice was never sent still shows. The card renders only when the list is non-empty, and ends with `APPEAL_LINE` (defined in `server/email/conduct-email.ts`, re-exported by `limits.ts`; never retype it).
- **Tests**: workers pool for actions, repo and standing; DOM pool for the form, detail and card.

## Rules that are easy to break

- **Standing is decided only in `standing.server.ts`.** A suspension is active `starts_on` through `ends_on` inclusive, in `CLUB_TIME_ZONE`; a termination holds until lifted; a record with `lifted_at` is over. Never re-derive it.
- **Records survive the account.** Every FK from a conduct table to `users` is `SET NULL`, never a cascade, and the subject's name is snapshotted on the record.
- **A viewer never sees records or reports about themselves**, even with `conduct:view` or `conduct:manage`. The filter lives in the repo layer (get returns null, list excludes), not in each caller. `memberConductSummaryAction` returns null for the subject.
- **Only `member_statement` ever leaves exec.** `internal_notes` stays with exec; audit metadata carries the level, transition and IDs only, never text, names or emails. No report text goes in any email.
- **Nothing above a Note is issued from a record referred to SCCS** until an outcome is recorded. The club does not adjudicate a possible SCOC violation.
- **A termination's vote is `votes_for * 3 >= committee_size * 2`**, enforced by both a DB CHECK and the Zod schema.
- **Client gates read `hasPermission("conduct:view")`**, and the member card renders nothing when the fn answers null.
- **Hold no readable list of removed addresses.** The email block is a keyed HMAC (a later commit adds it).

## Adding things

- **A new level or field**: schema through `db:generate` (additive only), then `limits.ts`, the repo, the action, the form and the detail view together.
- **A new place that needs standing**: call `standingFor` from `src/server/conduct/`; do not import from `features/conduct`.
- **A new mutation**: a `use-*.ts` hook in `features/conduct/api/` that invalidates `conductKeys.all`.
