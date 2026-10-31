# Member Conduct Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exec-only conduct records (Note / Warning / Suspension / Termination), member-filed reports with triage, site-sent notices, and enforcement that survives account deletion.

**Architecture:** A new `features/conduct` owns the tables' UI and actions. `src/server/conduct/` holds what other features ask: `standing.server.ts` (the only standing predicate) and `email-fingerprint.server.ts` (the HMAC). Termination reuses a deactivation helper hoisted out of `features/members` into `src/server/members/`.

**Tech Stack:** TanStack Start, React 19, Drizzle on D1, Temporal, Zod, Vitest (workers + jsdom pools), shadcn.

**Spec:** `docs/superpowers/2026-10-31-member-conduct/design.md`

## Global Constraints

- **One PR** on `feat/member-conduct`, built as the commits below. Each commit passes `pnpm verify` on its own.
- Every migration goes through `pnpm --filter ucmc-web db:generate --name <x>` (or `--custom`). Never hand-write a migration file or a journal entry. The DDL only adds.
- Retention: **5 years** after last activity or end date for notes, accepted reports, warnings, suspensions and lifted terminations. **1 year** after dismissal for dismissed reports. An active termination has no `retain_until` (NULL).
- Termination vote: `votes_for * 3 >= committee_size * 2`, enforced by a DB CHECK constraint and by the Zod schema.
- Calendar dates are `Temporal.PlainDate` in `CLUB_TIME_ZONE`. No raw `Date`.
- Server actions in `*-actions.server.ts`. `createServerFn` shells dynamic-import them. Every mutation has a `use-*.ts` hook.
- Client gates use `hasPermission` / `hasAnyPermission`. Server guards follow `club-feedback-actions.server.ts`'s `require*` helpers.
- `features/conduct` imports no other feature. Routes compose the pieces. Anything `features/auth`, `features/members` or `features/trips` needs lives in `src/server/conduct/`.
- Audit metadata carries the level, the state transition and IDs only. **Never** the statement, notes, report text, names or emails.
- No report text goes in any email.
- `/privacy` and `src/config/legal.ts` are legal copy. Write a **draft file only** and leave both unedited until the user approves.
- The wiki is pushed only after the user approves the row text.

## Review Focus

1. **An exec member is the subject of a record.** A `conduct:view` holder must not be able to read records or reports where they are the subject. Expect a 404-equivalent from `getConductRecordAction` and exclusion from list results. (Not in the spec. Raised with the user at handoff, and pinned in Task 3 pending their answer.)
2. **The subject's account is purged.** `subject_user_id` becomes NULL. The record, the list and `/conduct/$publicId` still render using `subject_name_snapshot`, with no member link (Task 3, Task 4).
3. **Suspension edge days.** On `ends_on`, a suspension is still active, and it is inactive the next day at 00:00 Cincinnati time, not UTC. Test with the clock at 23:30 local on `ends_on` (03:30 UTC the next day): `standingFor` still reports active (Task 2).
4. **Two managers triage the same report at once.** The second accept or dismiss fails with "already triaged" and writes no audit row, because the UPDATE is `WHERE status = 'new'` (Task 6).
5. **A terminated subject has several emails, or one is added later.** Every verified address at termination is fingerprinted. An existing member adding a blocked address is refused. A fingerprint is matched case- and dot-insensitively, exactly as `normalizeEmail` is (Task 10, Task 12).

---

## Commit 1: records

### Task 1: Schema, permissions, audit actions, retention rules

**Files:**

- Modify: `apps/ucmc-web/drizzle/schema.ts`: add `conductReports`, `conductRecords`, `conductRecordReports`, `conductBlockedEmails` and their enums. Add the audit actions to `auditAction`.
- Create (generated): `drizzle/migrations/NNNN_conduct_tables.sql` via `db:generate --name conduct_tables`
- Create (custom): `drizzle/migrations/NNNN_conduct_permissions_seed.sql` via `db:generate --custom --name conduct_permissions_seed`
- Create: `apps/ucmc-web/src/features/conduct/server/limits.ts`
- Create: `apps/ucmc-web/src/server/conduct/retention.ts`
- Test: `apps/ucmc-web/src/server/conduct/__tests__/retention.test.ts`, `apps/ucmc-web/src/features/conduct/server/__tests__/schema-constraints.test.ts`

**Interfaces:**

- Produces:
  - `conductLevel = ["note","warning","suspension","termination"] as const` and `ConductLevel`
  - `conductReportStatus = ["new","accepted","dismissed"]`
  - `scocState = ["none","referred","returned","sccs_sanctioned"]`
  - Drizzle tables `schema.conductReports`, `schema.conductRecords`, `schema.conductRecordReports`, `schema.conductBlockedEmails`, with the columns in the spec's data model, camelCased. Date columns use a `plainDate` custom type stored as `YYYY-MM-DD` text. Add it beside `instantMs` if no such type exists.
  - `retainUntil(input: { kind: "report"; status: ConductReportStatus; lastActivity: Temporal.Instant } | { kind: "record"; level: ConductLevel; endsOn: Temporal.PlainDate | null; liftedAt: Temporal.Instant | null; lastActivity: Temporal.Instant }): Temporal.Instant | null`
  - `limits.ts` exports `CONDUCT_LIMITS` (`bodyMax: 5000`, `statementMax: 5000`, `notesMax: 10000`, `descriptionMax: 500`, `liftReasonMax: 2000`), the Zod input schemas (named in Task 3 and Task 6), and label maps.

- [ ] **Step 1: Write the failing retention tests.**
  - Dismissed report: `retainUntil({kind:"report",status:"dismissed",lastActivity:T})` equals T plus 1 year (in `CLUB_TIME_ZONE`).
  - Accepted report: T plus 5 years.
  - Note: `lastActivity` plus 5 years.
  - Suspension: the end of `endsOn` in Cincinnati plus 5 years, when `endsOn` is later than `lastActivity`.
  - Active termination: `null`.
  - Lifted termination: `liftedAt` plus 5 years.
- [ ] **Step 2:** Run `pnpm --filter ucmc-web exec vitest run src/server/conduct/__tests__/retention.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `retainUntil` in `src/server/conduct/retention.ts`. Do the arithmetic as `ZonedDateTime` in `CLUB_TIME_ZONE`, using `.add({ years })`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Add the four tables to `schema.ts`.**
  - `subject_user_id`, `reporter_user_id`, `created_by`, `triaged_by`, `referred_by` and `lifted_by` all have `onDelete: "set null"`.
  - `conduct_record_reports` and `conduct_blocked_emails` have `onDelete: "cascade"` from the record or report.
  - Indexes: `(status, created_at)` on reports; `(subject_user_id)` and `(level, lifted_at)` on records; `(retain_until)` on both; and `(email_hmac)` on blocked emails.
  - CHECK constraints:
    - `level <> 'termination' OR (votes_for * 3 >= committee_size * 2 AND votes_for + votes_against + votes_abstain <= committee_size AND vote_held_on IS NOT NULL)`
    - `level <> 'termination' OR ((prior_warning_id IS NOT NULL) <> (warning_skipped = 1))`
    - `level <> 'suspension' OR (starts_on IS NOT NULL AND ends_on IS NOT NULL AND ends_on >= starts_on)`
    - `level = 'note' OR member_statement IS NOT NULL`
    - `level IN ('suspension','warning') OR ends_on IS NULL`
    - On reports: `subject_user_id IS NOT NULL OR subject_description IS NOT NULL`
  - Audit actions: `conduct.report_filed`, `conduct.report_triaged`, `conduct.record_created`, `conduct.record_updated`, `conduct.referred`, `conduct.sccs_outcome`, `conduct.lifted`. Each is added in the commit that first writes it, because the schema comment bans unused enum entries. Add `record_*`, `referred`, `sccs_outcome` and `lifted` here and the two `report_*` actions in Task 6.
- [ ] **Step 6:** Run `pnpm --filter ucmc-web db:generate --name conduct_tables`. Review the SQL: only `CREATE TABLE` and `CREATE INDEX`, and no rebuild of any existing table.
- [ ] **Step 7:** Run `db:generate --custom --name conduct_permissions_seed` and write the SQL, header-commented in the style of `0090_add_notice_manage_permission.sql`:
  - `perm_conduct_report` / `conduct:report` / "File a conduct report about another member. Grants no read access." goes to `role_member`.
  - `perm_conduct_view` / `conduct:view` / "Read conduct records and reports" goes to `role_president`, `role_treasurer` and `role_advisor`. Those are the only seeded exec roles. The comment says the board grants other exec roles at `/access`.
  - `perm_conduct_manage` / `conduct:manage` / "Create, triage and lift conduct records" goes to `role_president`.
  - None is `anonymous_grantable`.
- [ ] **Step 8: Write the constraint tests** in `schema-constraints.test.ts` (workers pool, factories from `src/test-support/factories`):
  - A termination with `votes_for: 4, committee_size: 7` is rejected. With `5, 7`, it inserts.
  - A termination with both `prior_warning_id` and `warning_skipped` is rejected, and so is one with neither.
  - A suspension without `ends_on` is rejected.
  - Deleting the subject user sets `subject_user_id` to NULL and keeps the row.
  - The seed grants `conduct:report` to `role_member`.
- [ ] **Step 9:** Run `pnpm --filter ucmc-web exec vitest run src/features/conduct src/server/conduct` and then `pnpm --filter ucmc-web db:drift`. Expected: PASS, and no drift.

### Task 2: Standing predicate

**Files:**

- Create: `apps/ucmc-web/src/server/conduct/standing.server.ts`
- Test: `apps/ucmc-web/src/server/conduct/__tests__/standing.test.ts`

**Interfaces:**

- Produces:
  - `interface ConductStanding { terminated: boolean; suspendedUntil: Temporal.PlainDate | null; activeRecordIds: string[] }`
  - `standingFor(userId: string, today?: Temporal.PlainDate): Promise<ConductStanding>`. `today` defaults to the current date in `CLUB_TIME_ZONE`.
  - `isTerminated(userId: string): Promise<boolean>`
  - `isBlockedEmail` and `possibleTerminatedNameMatches` are added here in Tasks 10 and 13.

- [ ] **Step 1: Write the failing tests.**
  - No records: `{terminated:false, suspendedUntil:null, activeRecordIds:[]}`.
  - Suspension `2026-11-01..2026-11-10`: active on `11-01` and `11-10`, inactive on `10-31` and `11-11`.
  - Overlapping suspensions: `suspendedUntil` is the later end.
  - A lifted suspension is inactive.
  - A termination is `terminated: true` until `lifted_at` is set.
  - A warning or note never affects standing.
  - Review Focus #3: with the clock mocked to `2026-11-11T03:30Z` (23:30 EST on `11-10`) and `today` omitted, the suspension is still active.
- [ ] **Step 2:** Run `pnpm --filter ucmc-web exec vitest run src/server/conduct/__tests__/standing.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement it as one query over `conduct_records` filtered by `subject_user_id`, `lifted_at IS NULL` and `level IN ('suspension','termination')`, comparing dates as `YYYY-MM-DD` strings. The module comment says this is the only place standing is decided, in the style of `current-attestation.server.ts`.
- [ ] **Step 4:** Run it again. Expected: PASS.

### Task 3: Record actions and server fns

**Files:**

- Create: `apps/ucmc-web/src/features/conduct/server/conduct-guards.server.ts`, `record-repo.server.ts`, `record-actions.server.ts`, `record-fns.ts`
- Test: `apps/ucmc-web/src/features/conduct/server/__tests__/record-actions.test.ts`

**Interfaces:**

- Consumes: the Task 1 tables and schemas, `retainUntil`, `buildAuditEventStatement`, `runBatch`.
- Produces:
  - Guards: `requireConductViewer(): Promise<Principal>`, `requireConductManager(): Promise<Principal>` and `requireConductReporter(): Promise<Principal>`.
  - Zod schemas in `limits.ts`:
    - `createRecordSchema`, a discriminated union on `level` carrying `subjectUserId`, `internalNotes`, `memberStatement?`, `startsOn?`, `endsOn?`, `possibleScoc`, `reportIds: string[]` (max 50) and, for a termination, `vote: {heldOn, for, against, abstain, committeeSize}` plus `priorWarningId` or `warningSkipped: true`.
    - `updateRecordSchema`, which edits `internalNotes` only (the statement is covered by the lock in Task 8).
    - `referSchema {recordId, referredOn}`.
    - `sccsOutcomeSchema {recordId, outcome: "returned"|"sccs_sanctioned", note}`.
    - `liftSchema {recordId, reason, appealOutcome?}`.
  - Actions:
    - `listConductRecordsAction(filter: {level?: ConductLevel; active?: boolean; referred?: boolean}): Promise<ConductRecordSummary[]>`
    - `getConductRecordAction(publicId: string): Promise<ConductRecordDetail | null>`
    - `createConductRecordAction(input): Promise<{ publicId: string }>`
    - `updateConductRecordAction(input): Promise<{ ok: true }>`
    - `referConductRecordAction(input): Promise<{ ok: true }>`
    - `recordSccsOutcomeAction(input): Promise<{ ok: true }>`
    - `liftConductRecordAction(input): Promise<{ ok: true }>`
    - `memberConductSummaryAction(userId: string): Promise<{ counts: Record<ConductLevel, number>; standing: ConductStanding; records: Array<{publicId; level; startsOn; liftedAt}> } | null>`, which returns `null` without `conduct:view`
  - Each action has a shell in `record-fns.ts` with the same name, minus `Action`, plus `Fn`.
  - `ConductRecordSummary` is `{ publicId, level, subjectName, subjectPublicId: string | null, startsOn, endsOn, scocState, liftedAt, createdAt }`. `ConductRecordDetail` adds every column, plus `reports: ConductReportSummary[]` (empty until Task 6) and `history: AuditRow[]`, read from `audit_log` where `target_type = 'conduct_record'` and `target_id` is the record id.

- [ ] **Step 1: Write the failing tests.**
  - Gates: `create`, `refer`, `outcome` and `lift` throw "Forbidden" without `conduct:manage`. `list` and `get` throw without `conduct:view`.
  - `create` snapshots `subjectName` from the profile's `fullName`.
  - A termination with `votes_for: 4, committee_size: 7` throws from the Zod validator, before the DB.
  - A termination's `priorWarningId` must be a warning on the same subject, or it throws.
  - The SCOC lock: `create` with `possibleScoc: true` and `level: "warning"` throws "Referred to SCCS". It is allowed for `level: "note"`, and the resulting row has `scoc_state: "referred"`. A `create` that attaches a report with `possible_scoc = 1` is also forced to referred.
  - After `recordSccsOutcome({outcome:"returned"})`, a new warning citing the same report is allowed.
  - `lift` sets `lifted_at`, recomputes `retain_until` to `lifted_at` plus 5 years, and a second `lift` throws "already lifted".
  - Every mutation writes exactly one audit row with `target_type = "conduct_record"`, and its `metadata_json` contains none of the statement or notes text (assert with `not.toContain`).
  - Review Focus #2: delete the subject user, and `getConductRecordAction` returns `subjectName` from the snapshot with `subjectPublicId: null`.
  - Review Focus #1: a manager who is the subject of a record gets `null` from `get` and does not see it in `list`.
- [ ] **Step 2:** Run `pnpm --filter ucmc-web exec vitest run src/features/conduct/server/__tests__/record-actions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Each mutation is one `runBatch` holding the write and its audit statement. "Last activity" is `updated_at`, and `retain_until` is recomputed in the same UPDATE. Repo functions take explicit arguments and do no auth.
- [ ] **Step 4:** Run it again. Expected: PASS.

### Task 4: `/conduct` page

**Files:**

- Modify: `apps/ucmc-web/src/server/settings/settings-registry.ts`: add `pages.conduct` (`z.boolean().default(true)`, category `pages`, `flagKind: "release"`, `owner: "system_admin"`, `createdAt: "2026-10-31"`), described as "When off, the Conduct sidebar entry is hidden and /conduct returns notFound."
- Create: `src/routes/conduct.tsx` (layout with tabs), `src/routes/conduct.index.tsx` (redirects to records), `src/routes/conduct.records.tsx` and `src/routes/conduct.$publicId.tsx`, then regenerate `routeTree.gen.ts` with `pnpm --filter ucmc-web build`
- Create: `src/features/conduct/api/{query-keys.ts,queries.ts,use-create-conduct-record.ts,use-update-conduct-record.ts,use-refer-conduct-record.ts,use-record-sccs-outcome.ts,use-lift-conduct-record.ts}`
- Create: `src/features/conduct/components/{records-table.tsx,record-detail.tsx,record-form.tsx,scoc-referral-panel.tsx,lift-dialog.tsx}`
- Modify: `src/components/layouts/app-layout.tsx`: a "Conduct" entry in the bottom utility group beside Access, shown when `hasAnyPermission(["conduct:view"]) && pages.conduct`
- Modify: `apps/ucmc-web/knip.config.ts` if knip flags the new routes
- Test: `src/features/conduct/components/__tests__/record-form.test.tsx`, `record-detail.test.tsx`

**Interfaces:**

- Consumes: the Task 3 fns.
- Produces:
  - `conductKeys` = `{ all: ["conduct"], records: (filter) => [...], record: (publicId) => [...], reports: ..., member: (userId) => [...] }`.
  - Every hook invalidates the `["conduct"]` prefix and `["members","detail"]`.

- [ ] **Step 1: Write the failing DOM tests** (`record-form.test.tsx`).
  - With `level = note`, there is no member-statement field.
  - Switching to `warning` shows the statement field, pre-filled from `STATEMENT_TEMPLATE`. That constant lives in `limits.ts` and names the conduct, the sanction, the dates, and a §9.3 line: "You may appeal in writing within two weeks to the Student Activities Board."
  - `termination` shows the vote fields. Submit stays disabled until `for*3 >= size*2`, and until either a prior warning is picked or "No prior warning" is checked. Submit opens an `AlertDialog`.
  - Checking "possible SCOC violation" removes the warning, suspension and termination options from the level select, and shows "513-556-6814".
- [ ] **Step 2: Write the failing `record-detail.test.tsx`.** With `subjectPublicId: null`, it renders the snapshot name as plain text, not a link. A lifted record shows "Lifted" with the reason.
- [ ] **Step 3:** Run `pnpm --filter ucmc-web exec vitest run src/features/conduct/components`. Expected: FAIL.
- [ ] **Step 4: Implement the components and routes.** Route guards use `requirePageFlag("pages.conduct")` and `requireAnyPermission(["conduct:view"])`, in the style of `access.tsx`. Manager-only controls are gated with `hasPermission("conduct:manage")`.
- [ ] **Step 5:** Run the DOM tests again. Expected: PASS. Then run `pnpm --filter ucmc-web build` and confirm `git diff --stat src/routeTree.gen.ts` shows the new routes.

### Task 5: Member-detail card and docs, then commit 1

**Files:**

- Create: `src/features/conduct/components/member-conduct-card.tsx`
- Modify: `src/routes/members.$publicId.tsx`: render the card when `hasPermission("conduct:view")`, fed by `memberConductSummaryFn`
- Create: `.claude/rules/feature-conduct.md` (paths `apps/ucmc-web/src/features/conduct/**`, `apps/ucmc-web/src/server/conduct/**`, `apps/ucmc-web/src/routes/conduct*.tsx`), shaped _Where things go / Rules that are easy to break / Adding things_, citing the ADR
- Create: `docs/adr/0012-conduct-records-outlive-the-account.md` from `docs/adr/template.md`. Update the index in `docs/adr/README.md`.
- Modify: `AGENTS.md` (an always-on invariant: "Conduct standing is decided only in `src/server/conduct/standing.server.ts`" and the rule list) and `README.md` (features)
- Test: `src/features/conduct/components/__tests__/member-conduct-card.test.tsx`

- [ ] **Step 1: Write the failing test.** Counts `{warning: 1, suspension: 1}` render "1 warning · 1 suspension". An active suspension shows "Suspended until Nov 10, 2026", formatted with the repo's date formatter from `dates-and-formats`.
- [ ] **Step 2:** Run it. Expected: FAIL. Implement the card. Run it again. Expected: PASS.
- [ ] **Step 3:** Run `pnpm verify`. Expected: exit 0.
- [ ] **Step 4:** Commit `feat(ucmc-web): exec-only conduct records with SCCS referral lock and §9.1 vote`.

## Commit 2: reports

### Task 6: Report actions

**Files:**

- Modify: `drizzle/schema.ts`: add the audit actions `conduct.report_filed` and `conduct.report_triaged`
- Modify: `src/server/settings/settings-registry.ts`: add `features.conduct_reports_enabled` (default `true`, "Accept conduct reports. Off blocks new reports only; triage stays available.")
- Modify: `src/server/rate-limit.server.ts`: add `checkConductReportRateLimit(userId)`, 5 per 24 hours
- Create: `src/features/conduct/server/{report-repo.server.ts,report-actions.server.ts,report-fns.ts}`
- Modify: `src/features/conduct/server/record-actions.server.ts`: `create` links `reportIds`, and `get` returns `reports`
- Test: `src/features/conduct/server/__tests__/report-actions.test.ts`

**Interfaces:**

- Produces:
  - `submitReportSchema {subjectUserId?, subjectDescription?, occurredOn, location, body, possibleScoc}`, refined so one of the two subject fields is present.
  - `submitConductReportAction(input): Promise<{ ok: true }>`. It returns no ID, so the reporter has nothing to read back.
  - `listConductReportsAction(status?: ConductReportStatus): Promise<ConductReportSummary[]>` (needs `conduct:view`).
  - `acceptConductReportAction({reportId, recordPublicId?}): Promise<{ ok: true }>` (`conduct:manage`). It attaches the report to an existing record, or the UI creates a record with `reportIds` instead.
  - `dismissConductReportAction({reportId, reason}): Promise<{ ok: true }>`.
  - `ConductReportSummary` is `{ id, reporterName: string | null, subjectName: string | null, subjectDescription, occurredOn, location, body, possibleScoc, status, triagedAt, dismissReason }`.

- [ ] **Step 1: Write the failing tests.**
  - `submit` without `conduct:report` throws.
  - With `features.conduct_reports_enabled` off, it throws "disabled", but `list` still works for a viewer.
  - The 6th report in 24 hours throws "Rate limit".
  - A reporter cannot read any report: there is no action that lists their own, and `list` throws for a member.
  - `dismiss` sets `retain_until` to plus 1 year. `accept` sets it to plus 5 years and links the record.
  - Review Focus #4: two `accept` calls on the same report. The second throws "already triaged", and there is exactly one `conduct.report_triaged` audit row.
  - A report can't name its own reporter as the subject.
  - Review Focus #1: a manager who is the subject of a report doesn't see it in `list`.
- [ ] **Step 2:** Run `pnpm --filter ucmc-web exec vitest run src/features/conduct/server/__tests__/report-actions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Triage UPDATEs are `WHERE id = ? AND status = 'new'` with `.returning()`, and zero rows throws.
- [ ] **Step 4:** Run it again. Expected: PASS.

### Task 7: Report dialog, reports tab, manager notification, then commit 2

**Files:**

- Create: `src/features/conduct/components/{report-dialog.tsx,reports-table.tsx,triage-actions.tsx}`, `src/features/conduct/api/{use-submit-conduct-report.ts,use-accept-conduct-report.ts,use-dismiss-conduct-report.ts}`
- Create: `src/routes/conduct.reports.tsx`. Point `conduct.index.tsx`'s redirect at reports when the viewer holds `conduct:manage`.
- Modify: the user menu in `src/components/layouts/app-layout.tsx` (where the club-feedback dialog item lives): add "Report a conduct concern", gated by `hasPermission("conduct:report") && features.conduct_reports_enabled`
- Modify: `src/server/notifications/notification-registry.ts`: add `"conduct.report_received"` (label "New conduct reports", description "An email when a member files a conduct report, so you can triage it.", `defaultEnabled: true`, `suppressible: true`)
- Create: `src/server/email/conduct-email.ts` with `conductReportReceivedEmail({ origin }): EmailMessage`-shaped content (subject "A new conduct report is waiting", body: one line and a link to `/conduct/reports`)
- Modify: `report-actions.server.ts`: after insert, send that email to each `conduct:manage` holder whose preference is on, recording each with `recordEmailSend`
- Test: `src/features/conduct/components/__tests__/report-dialog.test.tsx`, plus additions to `report-actions.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - The dialog's header text contains "with your name attached", and links to `https://www.uc.edu/campus-life/equity-inclusion/gender-equity/title-ix.html`. Confirm the current Title IX and anonymous-report URLs on uc.edu while writing and use what's there.
  - Ticking "I don't know their name" swaps the picker for a description field.
  - After submit it shows "Thanks — the Executive Committee will review this" and no link.
  - In `report-actions.test.ts`: submitting sends one email per opted-in manager, and the sent body does not contain the report `body` text.
- [ ] **Step 2:** Run them. Expected: FAIL. Implement. Run them again. Expected: PASS.
- [ ] **Step 3:** Run `pnpm verify`. Expected: exit 0. Commit `feat(ucmc-web): member-filed conduct reports with exec triage`.

## Commit 3: notices

### Task 8: `conduct.notice` email, preview and statement lock

**Files:**

- Modify: `notification-registry.ts`: add `"conduct.notice"` (label "Conduct notices", description "Formal notices from the Executive Committee about your membership.", `defaultEnabled: true`, `suppressible: false`, `alwaysOnReason: "The Executive Committee must be able to reach you about your membership."`)
- Modify: `src/server/email/conduct-email.ts`: `conductNoticeEmail({ level, statement, lifted, origin })`
- Modify: `record-actions.server.ts`: for warnings, suspensions and terminations, send the notice to the subject's primary email after the batch commits, then set `notice_sent_at`. `lift` sends a "lifted" notice. Add `previewConductNoticeAction(input): Promise<{subject: string; text: string}>`, pure, with no writes.
- Modify: `updateConductRecordAction`: the schema already excludes `memberStatement`. Also reject any edit to a record whose `notice_sent_at` is set, except to `internalNotes`.
- Add `supersedesPublicId?` to `createRecordSchema`, which sets `supersedes_id`.
- Test: additions to `record-actions.test.ts`, `src/server/email/__tests__/conduct-email.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - Creating a warning sends exactly one email to the subject's primary address, and its text equals `previewConductNoticeAction` on the same input.
  - A note sends none.
  - A member's preferences row turning `conduct.notice` off is ignored, because the category isn't suppressible.
  - `notice_sent_at` is set.
  - `lift` sends a notice containing "lifted".
  - A correction with `supersedesPublicId` links the old record and leaves the old statement unchanged.
- [ ] **Step 2:** Run them. Expected: FAIL. Implement. Run them again. Expected: PASS.

### Task 9: Preview in the form and the `/my` card, then commit 3

**Files:**

- Modify: `record-form.tsx`: a "Preview email" step before submit for non-note levels, using `previewConductNoticeFn`
- Create: `src/features/conduct/server/my-conduct-actions.server.ts` (`getMyActiveSanctionsAction(): Promise<Array<{level, statement, startsOn, endsOn}>>`, scoped to `principal.userId`, active warnings, suspensions and terminations only), and its fn
- Create: `src/features/conduct/components/my-conduct-card.tsx`. Modify `src/routes/my.index.tsx` to render it when the list is non-empty.
- Test: `my-conduct-card.test.tsx`, plus a `getMyActiveSanctionsAction` case in `record-actions.test.ts`

- [ ] **Step 1: Write the failing tests.** The card shows the statement and "until Nov 10, 2026" for a suspension. The action never returns notes, and never another user's records.
- [ ] **Step 2:** Run them. Expected: FAIL. Implement. Run them again. Expected: PASS.
- [ ] **Step 3:** Run `pnpm verify`. Expected: exit 0. Commit `feat(ucmc-web): send conduct notices to members and show active sanctions on /my`.

## Commit 4: enforcement

### Task 10: Email fingerprints and the new secret

**Files:**

- Modify: `src/server/env.server.ts`: `CONDUCT_EMAIL_KEY: optional(z.string().min(32))`, plus a `configurationProblems` entry requiring it when deployed (as for `SESSION_SECRET`)
- Modify: `.env.example`, `.github/actions/deploy/action.yml` (an input and the secret bulk upload, mirroring `SESSION_SECRET`, with no `${{ }}` inside `run:`), `.github/workflows/cicd.yml` (pass the secret to both deploys, and set a test value where `SESSION_SECRET` has one at line ~402), and `infra/github/index.ts` if it declares the secret list
- Create: `src/server/conduct/email-fingerprint.server.ts`, exporting `emailFingerprint(email: string): Promise<string>` (HMAC-SHA-256 via `crypto.subtle`, over `normalizeEmail(email)`, hex)
- Modify: `standing.server.ts`: `isBlockedEmail(email: string): Promise<boolean>`, joined to records where `lifted_at IS NULL`
- Modify: `record-actions.server.ts`: termination inserts one `conduct_blocked_emails` row per verified `user_emails` row, using `insertStatements`, in the same batch. `lift` deletes them in its batch.
- Test: `src/server/conduct/__tests__/email-fingerprint.test.ts`, plus additions to `standing.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `emailFingerprint("A.B@Gmail.com")` equals `emailFingerprint("ab@gmail.com")`, matching whatever `normalizeEmail` treats as equal.
  - Different keys give different fingerprints.
  - Review Focus #5: terminate a user with two emails, and `isBlockedEmail` is true for both. After `lift`, both are false.
  - A lifted termination with the user purged: false.
- [ ] **Step 2:** Run them. Expected: FAIL. Implement. Run them again. Expected: PASS.
- [ ] **Step 3:** Run `pnpm --filter ucmc-web exec vitest run src/server/__tests__/env.test.ts`. Expected: PASS, with a new case that a deployed env missing `CONDUCT_EMAIL_KEY` reports a problem.

### Task 11: Termination deactivates, reactivation refuses, `/deactivated` copy

**Files:**

- Create: `src/server/members/deactivate.server.ts`. Hoist `deactivateUserStatements(actorUserId: string, userIds: string[]): Promise<string[]>` out of `deactivateMembersAction`, covering the status UPDATE `WHERE status = 'approved'`, the session delete and the audit rows, and returning the IDs that transitioned.
- Modify: `src/features/members/server/member-actions.server.ts`: `deactivateMembersAction` calls the helper with no change in behaviour. `reactivateMembersAction` filters out IDs where `isTerminated(id)` and throws "Membership terminated; lift the termination first" if any were requested.
- Modify: `record-actions.server.ts`: on termination, after the record batch and the notice email, call the helper with `[subjectUserId]`
- Create: `src/features/conduct/server/termination-notice-fns.ts`: `getMyTerminationNoticeFn` returns `{ statement, appealText } | null` for the session user (the session survives the request that redirects to `/deactivated`) or for the proof-cookie email
- Modify: `src/routes/deactivated.tsx`: when that returns a notice, show "Your membership was terminated by the Executive Committee", the statement, and the §9.3 appeal text instead of the generic copy
- Test: `record-actions.test.ts` additions, the members action tests, and `src/routes/__tests__/deactivated.test.tsx` if a route test pattern exists (otherwise a component test of an extracted `DeactivatedNotice`)

- [ ] **Step 1: Write the failing tests.**
  - Terminating an approved member sets `status = "deactivated"`, deletes their sessions, and writes `member.deactivated` with the conduct manager as actor.
  - The existing `deactivateMembersAction` tests still pass unchanged.
  - `reactivateMembersAction([terminatedId])` throws. After `lift`, it succeeds.
  - The notice email is sent before the sessions are deleted (assert the order through the send log's timestamp, or a spy).
- [ ] **Step 2:** Run `pnpm --filter ucmc-web exec vitest run src/features/conduct src/features/members`. Expected: FAIL. Implement. Run it again. Expected: PASS.

### Task 12: Magic-link consume, email-add and profile-submit blocks

**Files:**

- Modify: `src/features/auth/server/magic-link-actions.server.ts`. In `consumeMagicLinkAction`, when no user owns the email (`!existing`) and `isBlockedEmail(proof.email)`, return `{ ok: false, reason: "conduct_terminated" }` and write no proof cookie. In `submitProfileAction`, re-check the proof email and throw the same reason.
- Modify: `src/features/auth/server/email-actions.server.ts`: `requestAddEmailAction` and `consumeAddEmailAction` return `{ ok: false, reason: "unavailable" }` for a blocked address, a generic reason so an existing member learns nothing
- Modify: `src/routes/auth.callback.tsx`: route `conduct_terminated` to `/deactivated?reason=terminated`. `/deactivated` (Task 11) shows the termination copy for that query without needing a session.
- Modify: the result-type unions so `reason` includes the new values
- Test: `src/features/auth/server/__tests__/` (the existing magic-link and email-action test files)

- [ ] **Step 1: Write the failing tests.**
  - After termination and a purge of the user row, a magic link for the old address returns `conduct_terminated`, and no proof cookie is set.
  - `requestMagicLinkAction` for that address returns the same result shape as for any other address (enumeration-proof).
  - A different member's `requestAddEmailAction` with the blocked address returns `unavailable`.
  - An unblocked new address still registers.
- [ ] **Step 2:** Run `pnpm --filter ucmc-web exec vitest run src/features/auth/server`. Expected: FAIL. Implement. Run it again. Expected: PASS.

### Task 13: Trip sign-up notice and name-match hint, then commit 4

**Files:**

- Modify: `src/routes/trip-sign-up.tsx`: load `getMyConductStandingFn` (a new fn in `features/conduct`, returning `{ suspendedUntil } | null` for the signed-in user). Pass `suspendedUntil` to `TripSignupEmbed`.
- Modify: `src/features/trips/components/trip-signup-embed.tsx`: a `suspendedUntil: Temporal.PlainDate | null` prop. When it's set, render an `Alert`, "You're suspended from club trips until {date}.", in place of the iframe, and keep the new-tab link out of that state.
- Modify: `standing.server.ts`: `possibleTerminatedNameMatches(names: string[]): Promise<Map<string, string[]>>`, keyed by input name. The values are record publicIds. Match case-insensitively on trimmed `subject_name_snapshot` of unlifted terminations, using `inJsonArray`.
- Modify: `listPendingRegistrationsAction` in `features/members` to include `conductMatch: string[] | null`, set only when the viewer holds `conduct:view`. Modify `src/routes/members._tabs.pending.tsx` to show a "Possible match to a terminated record" badge linking to `/conduct/$publicId`.
- Test: `src/features/trips/components/__tests__/trip-signup-embed.test.tsx` (existing), `standing.test.ts`, the pending-registrations action test

- [ ] **Step 1: Write the failing tests.**
  - The embed with `suspendedUntil` renders the alert and no `iframe`.
  - `possibleTerminatedNameMatches(["alex smith "])` matches the snapshot "Alex Smith", and ignores lifted terminations.
  - A pending applicant named like a terminated subject has `conductMatch` set for a `conduct:view` viewer and `null` for a `members:manage`-only viewer.
- [ ] **Step 2:** Run them. Expected: FAIL. Implement. Run them again. Expected: PASS.
- [ ] **Step 3:** Run `pnpm verify` and `pnpm --filter ucmc-web build && pnpm --filter ucmc-web size`. Expected: both exit 0. Commit `feat(ucmc-web): enforce conduct terminations and suspensions`.

## Commit 5: retention, export, privacy draft

### Task 14: Retention sweep

**Files:**

- Modify: `src/server/cron/retention.server.ts`: `sweepConductRetention(now)` deletes `conduct_reports` and `conduct_records` with `retain_until < now`, at most the existing per-tick sweep cap each, binding a fixed number of parameters. Link and fingerprint rows go by cascade. Add it to the cron's run list and the module comment's list.
- Test: `src/server/cron/__tests__/retention.test.ts` (existing)

- [ ] **Step 1: Write the failing tests.**
  - A record with `retain_until` yesterday is deleted, and so are its link and fingerprint rows.
  - One due tomorrow is kept.
  - An active termination (`retain_until` NULL) is kept.
  - Audit rows for the deleted record survive.
- [ ] **Step 2:** Run them. Expected: FAIL. Implement. Run them again. Expected: PASS.

### Task 15: Export, deletion survival, privacy draft, then commit 5

**Files:**

- Modify: `src/features/auth/server/magic-link-actions.server.ts`. In `exportMyDataAction`, add `conductNotices: Array<{level, statement, startsOn, endsOn, liftedAt, liftReason}>` (warnings, suspensions and terminations where the user is the subject) and `conductReportsFiled: Array<{occurredOn, location, body, createdAt}>`. Bump nothing else. In `deleteMyAccountAction`, delete no conduct rows (the FKs handle the NULLs), and add a comment saying so.
- Modify: `src/routes/api/account.export.ts` if it lists fields explicitly
- Create: `docs/superpowers/2026-10-31-member-conduct/privacy-draft.md`, the proposed `/privacy` section for the user's legal review. **Do not edit `legal.ts`.**
- Create: `docs/superpowers/2026-10-31-member-conduct/wiki-compliance-row.md`, the proposed matrix row. Push it to the wiki only after the user approves.
- Test: the existing export and delete tests in `src/features/auth/server/__tests__/`

- [ ] **Step 1: Write the failing tests.**
  - The export for a subject with a note, a warning and an internal-notes field contains the warning's statement. Its JSON contains neither the note's nor the internal notes' text, nor `reporterUserId`.
  - The export for a reporter contains their report body, and no `status` or `dismissReason`.
  - After `deleteMyAccountAction`, the reporter's report and the subject's record both still exist, with NULL user FKs.
- [ ] **Step 2:** Run them. Expected: FAIL. Implement. Run them again. Expected: PASS.
- [ ] **Step 3:** Run `pnpm verify`. Expected: exit 0. Then mutation-check `standing.server.ts`, `email-fingerprint.server.ts` and `conduct-guards.server.ts` with `pnpm --filter ucmc-web test:mutation` scoped to those files. Expected: no surviving mutants in the predicate or the gates. Commit `feat(ucmc-web): conduct retention sweep and data export`.
- [ ] **Step 4:** Hand the two draft files to the user. After approval, apply the `/privacy` copy in a follow-up commit on the same branch, and push the wiki row.
