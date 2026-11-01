# DRAFT: /privacy section on member conduct records

> **This is a proposal for your legal review. It is not in `src/config/legal.ts` and `/privacy` has not been changed.** Wording, headings and the retention figures below are for you to accept, edit or reject. Nothing here has been tidied into final prose on purpose. Once approved it goes into `PRIVACY_BODY` in a follow-up commit.

## Proposed section: Conduct records and reports

**What we keep.** The Executive Committee can keep a written record about a member's conduct. A record is one of four levels: a note, a warning, a suspension or a termination. It holds the member's name as it was when the record was made, the date, the committee's internal notes, and, for a warning, suspension or termination, the statement we sent to the member. A termination also holds the date and the count of the Executive Committee vote (votes for, against, abstaining, and the size of the committee). If a matter may be a Student Code of Conduct violation, the record also says it was referred to the University's Office of Student Conduct and Community Standards (SCCS), the date, and the outcome SCCS gave us.

Any approved member can also file a conduct report. A report holds who filed it, who it is about (or a description if the filer does not know the name), the date and place, what the filer says happened, and whether the filer thinks it may be a Student Code of Conduct violation. **A report is not anonymous: the Executive Committee sees who filed it.** UC's anonymous and Title IX reporting routes are linked from the report form for anyone who wants one.

**Who can see it.** Only people who hold the `conduct:view` or `conduct:manage` permission: by default the president, treasurer and club advisor (the president also holds `conduct:manage`). The Executive Committee can grant access to other officers. `conduct:manage` can create, change and lift records and triage reports. A person who is the subject of a record or report cannot see it in the site, even if they hold one of these permissions. A member sees only the notices we sent them (below), and a person who filed a report sees only that they submitted it. Platform administrators can technically reach the database, as with all data on the site.

**What the member is told.** When a warning, suspension or termination is recorded, we email the member the statement exactly as it was previewed to the officer. If no email address can be reached or the send fails, the record still stands, and it shows on their `/my` page while it is in force. A note is never sent to the member. These notices cannot be turned off in notification settings. Emails about reports sent to officers contain a link and no report text. When a warning, suspension or termination is lifted, we send a short notice that it was lifted. The notice does not include the lift reason, but the reason is recorded and appears in the member's data export (officers are told this when they enter it).

**How long we keep it.**

- Notes, warnings, suspensions and lifted terminations: five years after the last activity on the record, its end date, or the date it was lifted, whichever is latest.
- Reports that are new (not yet triaged) or accepted: five years after they were filed or last acted on.
- Dismissed reports: one year after dismissal.
- An active termination: kept as long as it stands, and for five years after it is lifted.
- A warning that a remaining termination relies on as its prior warning is kept until that termination is deleted. A report linked to a record we still hold is kept until that record is deleted.

A daily job deletes records and reports once their date passes. Audit log entries about conduct actions contain the level, the state change and internal IDs only, never the statement, notes, report text, names or email addresses, and are kept as the audit log is kept generally.

**What happens when an account is deleted.** Deleting your account, or its automatic removal, does **not** delete conduct records or reports. A record about you stays, with its link to your account removed and your name as it was when the record was made. A report you filed stays, with your account link removed, because a record may rely on it. Accounts are removed by you on request, or automatically: a deactivated account after 365 days (every terminated member's account is deactivated) and a rejected registration after 30 days. Officers cannot delete a claimed account. A report about you also stays, with a note of your name so it still says who it concerned. They are deleted on the schedule above.

**What is in your data export.** "Download my data" includes your warnings, suspensions and terminations, whether or not the notice email reached you (level, statement, dates and, if lifted, when and why) and the conduct reports you filed (date, place, text and when you filed them). It does **not** include notes, the committee's internal notes, reports about you, who filed any report, or SCCS referral details. Those are the club's records of its own decisions, not data you gave us, and they are kept for the reasons above.

**Blocking a terminated person's email addresses.** When a membership is terminated, we store a one-way keyed hash (HMAC-SHA-256 under a secret held in the site's configuration) of each email address on the account, so a terminated person cannot sign in or re-register with them. We do not keep a readable list of the addresses. The hash is removed if the termination is lifted. Be aware of the limits: it matches an address only after trimming spaces and lowercasing it. **It does not recognise provider aliases** such as Gmail dots or `+tag` addresses, so a different alias of the same mailbox is not blocked by this alone. Rotating the secret would also stop every existing block from matching.

**Name-match hint.** When an officer with `conduct:view` reviews a pending membership application, the site tells them if the applicant's name matches the name on an active termination, with a link to that record. It is only a hint. Nothing is blocked or approved automatically because of a name match, and an officer who is the subject of a record is never shown it.

**Limits.** Keeping these records does not replace the club's duties under the Student Code of Conduct or the Clery Act. Possible Code violations are referred to SCCS, and the advisor's Clery reporting happens off the site.

## Review notes for you

- Retention for a lifted termination (five years from lift) follows the retention rule in code: five years after the latest of last activity, end date and lift. Confirm that is the period you want to state.
- The sentence that platform administrators can reach the database is a candor line, not something the code adds. Keep or cut.
- "The Executive Committee and the club advisor" reflects the seeded role grants. The board can widen `conduct:manage` at `/access`, so the wording may need to say "people the board authorises".
- The report-about-you sentence rests on migration `0099`, which stamps the member's name onto the report when their account is deleted (see Task 15 report). Without it the deletion would have failed.
