# 0012. Conduct records outlive the account

- **Status:** Accepted
- **Date:** 2026-10-31
- **Issue:** none (designed in docs/superpowers/2026-10-31-member-conduct/)

## Context

The club keeps a confidential, exec-only record of warnings, suspensions and terminations so that an incoming board can see what a previous one decided. A record that vanishes when its subject deletes their account, or is swept by the 12-month purge, does nothing for institutional memory and lets a member erase a sanction by leaving. Cascading deletes are how every other table in the schema treats a user's data, so the default would quietly destroy these rows.

Enforcement has the same problem. A terminated person can register again on a fresh address, or on a known one. Blocking a known address needs something stored, but a readable list of removed people's emails is itself sensitive data held with no purpose beyond the block.

Retention also needs an answer, since the records are personal data kept after the account is gone.

## Decision

- **Records survive the account.** A conduct record snapshots the subject's name when it is written, and `subject_user_id` is `ON DELETE SET NULL`, never a cascade. Self-delete and the 12-month purge leave conduct rows in place. A reporter's reports likewise survive the reporter's account, since a record may depend on them.
- **A known address is blocked by a keyed HMAC, not a list.** At termination the site stores an HMAC of every normalized email on the account, keyed by a Worker secret. Sign-in and email-add compare against the hash. There is no readable list of removed people's addresses. A fresh address is only a name-match hint to `conduct:view` holders, never a block.
- **Retention is bounded.** Five years after last activity or end date for notes, accepted reports, warnings, suspensions and lifted terminations. One year after dismissal for dismissed reports. An active termination has no `retain_until` and is kept until it is lifted. A retention sweep deletes rows past `retain_until`; audit rows survive, as everywhere else.
- **Standing is decided in one place**, `src/server/conduct/standing.server.ts`, so auth, members and trips cannot drift apart.
- **A viewer never sees records or reports about themselves.** The filter lives in the repo layer, so no caller can forget it.

## Consequences

- Deleting an account does not delete conduct history. `/privacy` has to say so, and the data export must cover only what was sent to the member, never notes, internal notes, reporter identities or SCCS details.
- Every new FK from a conduct table to `users` must be `SET NULL`. A cascade here is a bug that destroys evidence, and it is easy to add by copying a neighbouring table.
- A hash cannot be reversed to recover an address, and a leaked database does not leak the removed list, but the secret becomes load-bearing: rotation lifts every block; it cannot be re-hashed, because plain addresses are never stored.
- The block matches only addresses `normalizeEmail` treats as equal (trim plus lowercase). Provider aliases such as gmail's dots and `+tags` are not canonicalised, so a terminated member can come back on an alias. That is accepted: the block then agrees with the `user_emails` unique index, which is the club's definition of "the same address". Canonicalising per provider would mean rules that disagree with the index and drift with every provider's policy.
- The name snapshot can go stale if a member later renames themselves. That is intended: the record shows who was named at the time.
- Known governance gap: Bylaws §9.1 authorizes termination only for repeated equipment or name misuse after a warning, and says nothing of conduct-based termination, time-limited suspension or skipping the warning. The site records these anyway, with no feature flag, by the user's decision. Being able to record a termination is not authority to issue one; the board should pursue a bylaw amendment. Until then, such a termination rests on §3.2's general grant alone.
