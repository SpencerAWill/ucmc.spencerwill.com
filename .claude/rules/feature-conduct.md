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
