# Member conduct records and sanctions

Status: approved design, 2026-10-31. Implementation plan to follow.

## Goals

1. **Institutional memory first.** A confidential, exec-only record of incidents, warnings, suspensions and terminations that survives officer turnover, so an incoming board can see what a previous one decided and why.
2. **Enforcement on top.** A terminated person cannot sign in or come back with a fresh account on a known address. A suspended member is turned away from trip sign-up. Real roster enforcement arrives with the trips feature, which calls the same standing check.
3. **Stay inside the club's authority.** The site follows the Bylaws (§3.2, §9.1–9.3) and the RSO Handbook's conduct protocol. It never lets the club adjudicate a possible Student Code of Conduct violation itself.

## Governing sources

All of these are in the [wiki](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki).

- **Bylaws §3.2.** The Executive Committee "shall … discipline members."
- **Bylaws §9.1.** Termination requires a prior warning from the Executive Committee and **a two-thirds vote of the entire Executive Committee**. The section's text covers only repeated abuse or misuse of club equipment or the club name.
- **Bylaws §9.2.** A terminated person forfeits all interest in club property and may not use the club name.
- **Bylaws §9.3.** A terminated member may appeal **in writing within two weeks** to the Student Activities Board, then to SALD within two weeks of that decision.
- **RSO Handbook, conduct procedures.** "If at any point, during a peer or office judicial process, there becomes knowledge of a possible Student Code of Conduct violation, the internal judicial process must cease, and the matter must be escalated to the Office of Student Conduct and Community Standards." SCCS can be reached at 513-556-6814 or through its online report form.
- **Compliance matrix `CSA`.** The Clery Act's Campus Security Authority obligations. This feature records incidents. **It does not discharge the advisor's Clery reporting**, which stays off-platform.

## Known governance gap (accepted)

§9.1 authorizes termination only for repeated equipment or name misuse after a warning. Nothing in the bylaws provides for terminating a member over trip conduct, for a time-limited suspension, or for skipping the warning in an egregious case. **This feature ships with the termination level enabled and no feature flag**, by the user's decision. The board should pursue a bylaw amendment covering conduct-based termination, suspension, and the skipped warning. Until that passes, a termination for conduct other than equipment or name misuse rests on §3.2's general grant alone. This design records the gap so nobody mistakes the site's ability to record a termination for authority to issue one.

## Decisions

| Question                                 | Decision                                                                                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                                  | **Both record and enforcement, record first.** Delivery order follows from it                                                                                                                                                 |
| Sanction ladder                          | Four levels, **Note → Warning → Suspension → Termination**. No narrower restrictions such as "can't lead" or "can't drive"; those go in a warning's text                                                                      |
| Permanent or for a period                | **Split by level.** A suspension has a required end date and ends on its own. A termination has no end date and lasts until exec lifts it, for example after a §9.3 appeal                                                    |
| "Instant ban"                            | A termination recorded with `warning_skipped = true`, an explicit acknowledgment that the §9.1 warning step was skipped                                                                                                       |
| Who reads                                | **`conduct:view`**, seeded to every Executive Committee role and the advisor. §9.1 needs the whole committee, so every voter can read the record                                                                              |
| Who writes                               | **`conduct:manage`**, seeded to the president, who receives all SCCS correspondence under the RSO Handbook. The board widens it at `/access`                                                                                  |
| Who reports                              | **`conduct:report`**, seeded to `role_member`, because anyone in the club can lead a trip. Same arrangement as `club_feedback:submit`                                                                                         |
| What a report is                         | **An intake item, not a record.** It lands in a triage queue. A `conduct:manage` holder accepts it (into a new or existing record) or dismisses it with a reason. A report is never part of someone's history unless accepted |
| Reporter anonymity                       | **Always identified to exec.** The form links UC's anonymous and Title IX channels for anything the reporter will not sign                                                                                                    |
| What the reporter sees afterwards        | A confirmation, then nothing. No status and no read-back                                                                                                                                                                      |
| What the subject sees                    | Nothing for notes or reports. Warnings, suspensions and terminations are **sent by the site** and shown on `/my` while active                                                                                                 |
| Two text fields                          | `member_statement` is what the member is told. `internal_notes` stays with exec. Only the statement ever leaves exec                                                                                                          |
| Correcting a sent statement              | Not editable once sent. A correction is a new record that supersedes the old one                                                                                                                                              |
| SCOC boundary                            | A record flagged as a possible SCOC violation is **referred to SCCS**. While it is referred, **nothing above a Note can be issued from it** until an SCCS outcome is recorded                                                 |
| Interim safety suspension while referred | **Not offered.** Interim measures are SCCS's to impose. A trip leader can still decline to take someone                                                                                                                       |
| §9.1 vote                                | **The outcome is recorded, with no in-site ballot.** Date, for, against, abstaining and committee size, attested by the person entering it. The database enforces `votes_for * 3 >= committee_size * 2`                       |
| Suspension vote                          | **None.** A `conduct:manage` holder issues one directly                                                                                                                                                                       |
| Model                                    | **Separate conduct tables plus one shared standing predicate** in `src/server/conduct/`. New `users.status` values and an append-only event log were rejected                                                                 |
| Surviving the account                    | Records snapshot the subject's name, and `subject_user_id` is `SET NULL`, never a cascade. Self-delete and the 12-month purge leave conduct rows in place                                                                     |
| Blocking a known address                 | **A keyed HMAC** of every normalized email on the account at termination, using a new Worker secret. No readable list of removed people's addresses                                                                           |
| Fresh address                            | A **name-match hint** in the pending-registration queue, visible to `conduct:view` holders. A hint only, never a block                                                                                                        |
| Retention                                | **5 years** for notes, accepted reports, warnings, suspensions and lifted terminations. **1 year** for dismissed reports. An active termination is kept until it is lifted                                                    |
| Attachments                              | **None.** No photos or files                                                                                                                                                                                                  |
| Gear                                     | **Separate.** A suspension does not block gear checkout, because §1.5 gives that decision to the Gear Manager                                                                                                                 |
| Feature flag on termination              | **None** (see the governance gap above)                                                                                                                                                                                       |

## Data model

All in `drizzle/schema.ts` through `db:generate`. Every table is new, so the DDL only adds.

### `conduct_reports`

| Column                                       | Notes                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `id`, `public_id`                            |                                                                          |
| `reporter_user_id`                           | FK `users.id`, `SET NULL`. Always set at insert                          |
| `subject_user_id`                            | Nullable FK, `SET NULL`. Null when the reporter does not know who it was |
| `subject_description`                        | Free text. Required when `subject_user_id` is null                       |
| `occurred_on`                                | `Temporal.PlainDate`, Cincinnati-local                                   |
| `location`                                   | Free text. A nullable `event_id` is added by the trips work, not here    |
| `body`                                       | What happened                                                            |
| `possible_scoc`                              | Boolean, the reporter's answer to the plain-language SCOC question       |
| `status`                                     | `new` \| `accepted` \| `dismissed`                                       |
| `triaged_by`, `triaged_at`, `dismiss_reason` | Set on accept or dismiss                                                 |
| `retain_until`                               | Recomputed on every change                                               |
| `created_at`                                 |                                                                          |

### `conduct_records`

| Column                                                                          | Notes                                                                                                                            |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `public_id`                                                               |                                                                                                                                  |
| `level`                                                                         | `note` \| `warning` \| `suspension` \| `termination`                                                                             |
| `subject_user_id`                                                               | Nullable FK, `SET NULL`, no cascade                                                                                              |
| `subject_name_snapshot`                                                         | Taken at creation                                                                                                                |
| `member_statement`                                                              | Null for a note, required for the other three. Immutable once the notice is sent                                                 |
| `internal_notes`                                                                | Exec only                                                                                                                        |
| `starts_on`, `ends_on`                                                          | `PlainDate`. `ends_on` is required for a suspension, optional for a warning, null for a note or termination                      |
| `scoc_state`                                                                    | `none` \| `referred` \| `returned` \| `sccs_sanctioned`                                                                          |
| `referred_on`, `referred_by`, `sccs_outcome_note`                               |                                                                                                                                  |
| `vote_held_on`, `votes_for`, `votes_against`, `votes_abstain`, `committee_size` | Termination only. CHECK: `votes_for * 3 >= committee_size * 2` and `votes_for + votes_against + votes_abstain <= committee_size` |
| `prior_warning_id`                                                              | Self-FK to a warning on the same subject                                                                                         |
| `warning_skipped`                                                               | Boolean. A termination needs exactly one of `prior_warning_id` or `warning_skipped` (CHECK)                                      |
| `supersedes_id`                                                                 | Self-FK, for corrections                                                                                                         |
| `lifted_at`, `lifted_by`, `lift_reason`, `appeal_outcome`                       |                                                                                                                                  |
| `notice_sent_at`                                                                |                                                                                                                                  |
| `created_by`, `created_at`, `updated_at`, `retain_until`                        |                                                                                                                                  |

CHECK constraints also tie `level` to the columns it requires, for example a suspension needs both dates.

### `conduct_record_reports`

`(record_id, report_id)`, many-to-many. One report can back a note and, later, a termination.

### `conduct_blocked_emails`

`(record_id, email_hmac)`. Filled from every email on the account when a termination is created. Deleted when the termination is lifted or purged. The key is a new secret, **`CONDUCT_EMAIL_KEY`**, added to env validation (ADR 0011), `scripts/wrangler-env.ts` and Pulumi. It hashes the output of the existing email normaliser.

### Permissions (migration)

`conduct:report` goes to `member`. `conduct:view` goes to every Executive Committee role and the advisor. `conduct:manage` goes to the president. None is `anonymous_grantable`.

### Audit actions

`conduct.report_filed`, `conduct.report_triaged`, `conduct.record_created`, `conduct.record_updated`, `conduct.referred`, `conduct.sccs_outcome` and `conduct.lifted`. Metadata carries the level, the state transition and IDs only. **It never carries the statement, the notes or report text**, per the audit log's PII rule.

## Surfaces

### Filing a report (`conduct:report`)

- The user menu gains **"Report a conduct concern"**, which opens a dialog like club feedback.
- Fields: a member picker or "I don't know their name" plus a description, a date, a location, what happened, and the SCOC question.
- The header copy says the report goes to the Executive Committee **with your name attached**. It links UC's anonymous and Title IX reporting, and 911 or UCPD for emergencies.
- After submitting, the reporter sees a confirmation only. Reports do not appear on `/my/feedback`.
- Rate-limited per reporter, like club feedback.
- `features.conduct_reports_enabled` (default on) blocks new submissions only.

### `/conduct` (`conduct:view` plus the `pages.conduct` kill switch)

- Its sidebar entry sits in the bottom utility group beside Access and Settings, gated on the same flag.
- **Reports tab.** `new` reports first. `conduct:manage` holders can Accept (attach to an existing record or start one, defaulting to a Note) or Dismiss with a reason. `conduct:view` holders read only.
- **Records tab.** Filters for level, active or lifted, and referred.
- **`/conduct/$publicId`.** The record, its linked reports, the lifecycle actions, and the record's audit history.

### Record form (`conduct:manage`)

The fields change with the level:

- **Note:** internal notes only.
- **Warning or suspension:** a member statement, pre-filled from a template covering the conduct, the sanction, the dates and the §9.3 appeal route. Plus internal notes and dates, and **a preview of the exact email** before sending.
- **Termination:** all of the above, plus the vote fields and either a prior-warning picker or the "no prior warning" acknowledgment, behind an `AlertDialog`.
- **SCOC referral mode.** Flagging a record, or accepting a flagged report, shows the SCCS contacts and asks for the referred date. It removes the Warning, Suspension and Termination options until an outcome is recorded. A referred record also states that it does not discharge Clery reporting.

### `/members/$publicId`

A **Conduct card** for `conduct:view` holders only, showing counts by level, any active suspension or termination, and links. The route composes it from `features/conduct`, so `features/members` does not import `features/conduct`.

### `/my`

While a warning, suspension or termination is active, a card shows the statement, the dates and the appeal route. Notes and reports never appear.

### Pending-registration queue

`conduct:view` holders see a "possible match to a terminated record" hint when an applicant's name matches a terminated subject's snapshot.

## Enforcement

`src/server/conduct/standing.server.ts` is the **only** place standing is decided:

- **`standingFor(userId)`** returns `{ suspendedUntil?, terminated, recordIds }`. A suspension is active while `starts_on ≤ today ≤ ends_on` in `CLUB_TIME_ZONE`, so it ends with no cron and no state change.
- **`isBlockedEmail(normalizedEmail)`** checks the address against `conduct_blocked_emails` for terminations that have not been lifted.
- **`possibleTerminatedNameMatches(names)`** backs the registration hint.

Creating a termination runs these steps in order:

1. Insert the record and fingerprint every email on the account, in one batch.
2. Send the `conduct.notice` email.
3. Run the **existing deactivation action**, which sets the status to `deactivated`, revokes sessions and writes `member.deactivated`.

`/deactivated` reads standing and, for a terminated person, shows the termination copy and the §9.3 appeal steps instead of the generic text.

Lifting a termination removes its fingerprints but **does not reactivate the account**. Exec reactivates from `/members`, and the reactivate action refuses while a termination is active.

**Magic link.** The request stays enumeration-proof: the same response whether or not the address is blocked. **The consume step** refuses to create a session or registration for a blocked address and shows the termination notice, which is safe because the visitor has just proved they control the inbox. Adding an email to an existing account runs the same check.

**`/trip-sign-up`.** A signed-in suspended member sees "you're suspended from club trips until DATE" **in place of the embed**. The form's direct link still works, so this is a speed bump. The trips feature makes it a gate by calling `standingFor` at sign-up, which is out of scope here.

## Notifications

These are registry entries, not rows.

- **`conduct.notice`** goes to the subject on a warning, suspension or termination, and when one is lifted. It is **`suppressible: false`**, goes to the primary email, and its body is the previewed `member_statement`.
- **`conduct.report_received`** goes to `conduct:manage` holders when a report arrives. It is suppressible. **No report content goes in the email**, only a link.

## Privacy, retention and compliance

- **Retention cron.** A new sweep in `retention.server.ts` deletes rows past `retain_until`, along with their link rows and fingerprints. It is capped per tick and binds a fixed number of parameters (ADR 0006). Audit rows survive, as they do everywhere else.
- **Account deletion and purge.** These leave conduct rows in place and set the user FKs to null. A reporter's reports also survive the reporter's account deletion, since a record may depend on them.
- **Export.** `exportMyDataAction` adds the member's warnings, suspensions and terminations as sent (level, dates, statement, lift details), and the reports the member filed (their own text only). It excludes notes, internal notes, reports about them, reporter identities and SCCS details.
- **`/privacy`.** A new section is **drafted for the user's review as legal copy**. It covers what is collected, who sees it, retention, survival past account deletion, the export scope and the hashed address block. It is not committed as tidied prose.
- **Wiki compliance matrix.** A new row maps Bylaws §3.2 and §9.1–9.3, the RSO Handbook SCCS hand-off and `CSA` to their files. "Advisor CSA acknowledgment" stays open.
- **Docs in the same change.** A new ADR, _conduct records outlive the account_. A scoped `.claude/rules/feature-conduct.md`. `AGENTS.md` and `README.md` updates for the secret and the feature.

## Testing

- **Workers pool:**
  - The actions, with permission gates for `report`, `view`, `manage` and none.
  - `standingFor`: suspension boundary days in Cincinnati time, and a lifted termination.
  - The HMAC block at magic-link consume and at email add.
  - The ⅔ and level CHECK constraints.
  - The SCOC lock.
  - Retention windows.
  - The export shape, including that internal fields are absent.
  - The reactivation refusal.
  - Fixtures from the shared D1 test factories (#323).
- **DOM pool:** the level-dependent form, the notice preview, the `/my` card and the `/trip-sign-up` suspension notice.
- **Mutation-check** the standing predicate and the permission gate tests.

## Delivery

**One PR**, by the user's decision, built as sequenced commits that are each green and independently revertable, in this order:

1. Schema, permissions, audit actions, `standing.server.ts`, and `/conduct` with **records only**: all four levels, the SCOC lock and the vote. Includes the page flag, sidebar entry, member-detail card, rule file and ADR.
2. Member reports: the dialog, triage, `conduct.report_received` and the reports feature setting.
3. Notices: `conduct.notice`, the email preview and the `/my` card.
4. Enforcement: the secret, fingerprints, the consume and email-add block, `/deactivated` copy, the reactivation refusal, the `/trip-sign-up` notice and the name-match hint.
5. Retention sweep, export, the `/privacy` draft for review, and the wiki row.

## Out of scope

- Trip-roster enforcement (the trips spec).
- In-site exec ballots.
- Attachments.
- Interim safety suspensions while referred.
- Gear restrictions.
- Clery reporting.
- Any automatic action on a name match.
