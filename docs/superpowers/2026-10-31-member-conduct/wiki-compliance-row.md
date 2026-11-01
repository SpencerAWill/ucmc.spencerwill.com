# DRAFT: wiki compliance matrix additions (member conduct)

Proposed for `Compliance.md` in the wiki. **Not pushed.** The wiki matrix is not a single table: "Source documents" is a two-column table of codes, and each obligation is a `###` block with **Obligation:** / **Implementation:** lines (see "Self-serve data export" for the style). Below are the new table rows, the new block, and the one row in the operational table that stays open. Links use the same `blob/main` pattern.

## 1. Add to the "Source documents" table

| Code       | Document                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BYLAW3.2` | UCMC Bylaws §3.2 — the Executive Committee disciplines members                                                                                                                              |
| `BYLAW9`   | UCMC Bylaws §9.1–9.3 — termination (prior warning, two-thirds vote of the whole committee), forfeiture, written appeal within two weeks to the Student Activities Board then SALD           |
| `SCCS`     | UC RSO Handbook, conduct procedures — a possible Student Code of Conduct violation must stop the internal process and be escalated to the Office of Student Conduct and Community Standards |

`CSA` (Federal Clery Act) is already in the table.

## 2. Add a section after "Waiver flow" (or under "RBAC + governance")

```markdown
## Member conduct (`BYLAW3.2`, `BYLAW9`, `SCCS`, `CSA`)

### `BYLAW3.2` + `BYLAW9` — Disciplining and terminating members

**Obligation:** the Executive Committee disciplines members (§3.2). A termination needs a prior warning and a two-thirds vote of the entire committee (§9.1). A terminated person forfeits club property and the club name (§9.2) and may appeal in writing within two weeks, then to SALD (§9.3). **Known gap:** §9.1's text covers only equipment or club-name misuse; conduct-based termination, suspension and a skipped warning need a bylaw amendment, and until then rest on §3.2 alone.

**Implementation:** records live in `conduct_records` ([`schema.ts`](https://github.com/SpencerAWill/ucmc.spencerwill.com/blob/main/apps/ucmc-web/drizzle/schema.ts)); the vote rule `votes_for * 3 >= committee_size * 2` is a DB CHECK and is repeated in the Zod schema in [`limits.ts`](https://github.com/SpencerAWill/ucmc.spencerwill.com/blob/main/apps/ucmc-web/src/features/conduct/server/limits.ts). A termination needs `prior_warning_id` or an explicit `warning_skipped`. Logic and guards in [`record-actions.server.ts`](https://github.com/SpencerAWill/ucmc.spencerwill.com/blob/main/apps/ucmc-web/src/features/conduct/server/record-actions.server.ts) and [`conduct-guards.server.ts`](https://github.com/SpencerAWill/ucmc.spencerwill.com/blob/main/apps/ucmc-web/src/features/conduct/server/conduct-guards.server.ts). Standing is decided only in [`standing.server.ts`](https://github.com/SpencerAWill/ucmc.spencerwill.com/blob/main/apps/ucmc-web/src/server/conduct/standing.server.ts). Permissions via the conduct permission migrations: `conduct:view` is seeded to the president, treasurer and advisor (other Executive Committee roles are granted it at `/access`), `conduct:manage` to the president, and `conduct:report` to `role_member`. The appeal route is the `APPEAL_LINE` in [`conduct-email.ts`](https://github.com/SpencerAWill/ucmc.spencerwill.com/blob/main/apps/ucmc-web/src/server/email/conduct-email.ts), shown in the notice email, the `/my` card and [`/deactivated`](https://github.com/SpencerAWill/ucmc.spencerwill.com/blob/main/apps/ucmc-web/src/routes/deactivated.tsx). Enforcement: a termination deactivates the account and stores keyed hashes of its addresses ([`email-fingerprint.server.ts`](https://github.com/SpencerAWill/ucmc.spencerwill.com/blob/main/apps/ucmc-web/src/server/conduct/email-fingerprint.server.ts)) that block sign-in and re-registration; a lift does not reactivate. A suspension blocks the `/trip-sign-up` embed for its dates. Trip-roster enforcement is out of scope.

### `SCCS` — Hand-off of possible Student Code of Conduct violations

**Obligation:** when a possible violation is known, the club process stops and the matter goes to SCCS.

**Implementation:** a report or record flagged `possible_scoc` is put in referred mode; while referred, nothing above a Note can be issued until an SCCS outcome is recorded (the lock in [`conduct-guards.server.ts`](https://github.com/SpencerAWill/ucmc.spencerwill.com/blob/main/apps/ucmc-web/src/features/conduct/server/conduct-guards.server.ts)). The form shows the SCCS contacts. The club does not adjudicate the matter and does not impose interim suspensions while referred.

### `CSA` — Clery Act

**Obligation:** Campus Security Authority reporting.

**Implementation:** none. The site records incidents; it does **not** discharge the advisor's Clery reporting, which stays off-platform, and the referred-record screen says so. See the open item below.

### Conduct data: privacy, retention, export, deletion

- **Retention:** `sweepConductRecords` and `sweepConductReports` in [`retention.server.ts`](https://github.com/SpencerAWill/ucmc.spencerwill.com/blob/main/apps/ucmc-web/src/server/cron/retention.server.ts), dates computed by [`retention.ts`](https://github.com/SpencerAWill/ucmc.spencerwill.com/blob/main/apps/ucmc-web/src/server/conduct/retention.ts): five years for records and accepted reports, one year after dismissal, an active termination never.
- **Survival past account deletion:** every FK to `users` is SET NULL; `deleteMyAccountAction` deletes no conduct rows ([ADR 0012](https://github.com/SpencerAWill/ucmc.spencerwill.com/blob/main/docs/adr/0012-conduct-records-outlive-the-account.md)). Migration `0099` stamps a report's subject name before the user row goes.
- **Export:** `exportMyDataAction` adds `conductNotices` (own warnings, suspensions, terminations as sent) and `conductReportsFiled` (own report text). Notes, internal notes, reports about the member, reporter identity and SCCS fields are excluded.
- **Visibility:** a `conduct:view` / `conduct:manage` holder cannot see records or reports about themselves.
- **Privacy notice:** `/privacy` section added after legal review (see the draft in the repo).
```

## 3. Operational obligations table: no change

| Obligation                                             | Status                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| Advisor CSA acknowledgment recorded in officer runbook | **Pending** (still open; the conduct feature does not close it) |
