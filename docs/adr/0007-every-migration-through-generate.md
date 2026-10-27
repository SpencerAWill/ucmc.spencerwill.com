# 0007. Every migration goes through `drizzle-kit generate`, and only adds

- **Status:** Accepted
- **Date:** 2026-10-19
- **Issue:** #318

## Context

`drizzle-kit generate` writes a migration, its `_journal.json` entry and a snapshot of `schema.ts`, and the next `generate` diffs against that snapshot. Migrations `0060`–`0083` were written by hand, for backfills, triggers and FTS, which Drizzle can't express. They had journal entries but no snapshots. The chain stopped at `0059`, and `generate` read the gap as table renames and blocked on a prompt.

D1 adds two constraints of its own. **SQLite pragmas are silently ignored inside a migration**: each file is applied as one implicit transaction, where `PRAGMA foreign_keys=OFF` is a no-op. SQLite has no `ALTER COLUMN`, so tightening a constraint means a create-copy-drop-rename rebuild. Measured on `users`, the parent of 40 foreign-key edges, a rebuild cascade-deletes rows, nulls audit attribution and aborts on a `RESTRICT` edge, all without an error until the last. And **migrations run before `wrangler deploy`, prod migrates after dev in the same pipeline, and rollback is code-only** (ADR 0002), so old code runs on the new schema.

## Decision

- **Every migration goes through `generate`**: `db:generate --name <what>` for derivable DDL, `db:generate --custom --name <what>` for an empty file to write SQL into. Never a migration file or journal entry by hand. `0084_snapshot.json` restarted the chain from `schema.ts`.
- **`db:drift`** runs `generate` on a temp copy in `pnpm verify` and CI, and fails if it would write anything, if files and journal entries don't pair up, or if it wanted to prompt about a rename.
- **Migrations only add** (expand now, contract in a later release). Generated DDL gets the same review as hand-written, because a nullability change comes out as a rebuild.
- **A constraint on a referenced table is a `BEFORE INSERT` / `BEFORE UPDATE OF` trigger pair that aborts**, not a rebuild (`0071` is the worked example).

## Consequences

- The snapshot follows `schema.ts`, not the database, where the two knowingly differ (trigger-enforced columns, FTS tables). `schema-drift.test.ts` remains the check against the database itself.
- Renames take two releases, and a removed column lingers until the code that read it is gone. The `rename-permission-or-setting` skill covers the string-keyed cases.
- drizzle-kit 0.31 exits 0 on its own prompt error, so the drift script treats any stderr as a failure.
