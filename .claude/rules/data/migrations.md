---
paths:
  - "apps/ucmc-web/drizzle/**"
  - "apps/ucmc-web/scripts/check-migration-drift.ts"
  - "apps/ucmc-web/src/server/db/__tests__/**"
---

# Writing D1 migrations

Part of the data rule; `data/core.md` covers the bindings and the parameter limit.

## Writing a migration: always through `generate` (#318)

`db:generate --name <what_it_does>` for DDL Drizzle can derive from `schema.ts`; `db:generate --custom --name <what_it_does>` for an empty file to write SQL into. Both write the journal entry **and** `meta/NNNN_snapshot.json`, a snapshot of `schema.ts` that the next `generate` diffs against. Give a `--custom` file the explanatory header the hand-written ones carry.

- **No migration file or journal entry by hand.** `0060`–`0083` were, so they have no snapshots; `generate` read that gap as table renames and blocked on a TTY prompt. `0084_snapshot.json` restarted the chain from `schema.ts`.
- **`db:drift`** (`scripts/check-migration-drift.ts`, in `pnpm verify` and CI's web job) runs `generate` on a temp copy and fails if it would write anything, if a `.sql` file and a journal entry don't pair up or an entry from `0084` on has no snapshot (the hand-written data-only migration a schema diff can't see), or if it wanted to ask about a rename: drizzle-kit 0.31 swallows that error and exits 0, so the script treats any stderr as failure. Answer a rename prompt by running `db:generate` in a terminal.
- **The snapshot follows `schema.ts`, not the database, where they knowingly differ**: `users.public_id` (nullable in D1, trigger-enforced; see `KNOWN_NULLABILITY_DRIFT`), `roles.display_name` (`DEFAULT ''` in D1 only), and the FTS5 tables and triggers. Recording the database's version would make the next `generate` emit a rebuild. `schema-drift.test.ts` remains the check against the database itself.
- **Generated DDL gets the same review as hand-written.** A nullability or constraint change comes out as create-copy-drop-rename, which is exactly the trap below.

## SQLite pragmas do not work in a migration, so a parent table cannot be rebuilt

**`PRAGMA foreign_keys`, `defer_foreign_keys` and `legacy_alter_table` are accepted by D1 and silently ignored inside a migration.** SQLite makes them no-ops within a transaction, and every migration file is applied as one implicitly transactional batch — `applyD1Migrations` does `db.batch(queries)`, and `wrangler d1 migrations apply` does the same. Accepted is not honoured, and nothing reports the difference.

This matters because SQLite has no `ALTER COLUMN`: tightening a constraint means the create-copy-drop-rename rebuild, which is **only** safe with foreign keys off. **`0026_unclaimed_status.sql` and `0030_gear_description_required.sql` both open with `PRAGMA foreign_keys=OFF` and both worked — but neither proves the pragma did anything.** The tables they rebuilt (`user_emails`, `gear`) have no children, so there was nothing to cascade either way. Copying that pattern onto a referenced table is the trap.

Measured on `users`, the parent of **40 foreign key edges across 28 tables**: the rebuild completes, raises no error and leaves a valid schema, while

- **7 `ON DELETE CASCADE`** edges delete their rows (`sessions`, `profiles`, `user_roles`, `user_emails`, …),
- **32 `ON DELETE SET NULL`** edges blank their columns — including both actor columns on `audit_log`, so rows survive looking fine with their attribution gone,
- **1 `ON DELETE RESTRICT`** edge (`gear_loans`) aborts the migration outright once a single loan row exists, and migrations run _before_ `wrangler deploy`.

`defer_foreign_keys` defers violation _checking_ to commit; it does not suppress cascade _actions_. Renaming the parent out of the way first does not help either: with foreign keys live, `ALTER TABLE … RENAME` rewrites every `REFERENCES` clause to follow the rename, so the children track the old table wherever it goes and whatever gets dropped is always the thing they point at.

**So: to constrain a column on a referenced table, use a `BEFORE INSERT` / `BEFORE UPDATE OF` trigger pair that `RAISE(ABORT, …)`s.** It is enforced by the database, so it covers writers that bypass Drizzle (`drizzle/seed.ts`, the raw SQL in `seed-admin.yml`), and the abort message can match what the real constraint would have said. `0071_users_public_id_not_null.sql` is the worked example, and the cost is that `PRAGMA table_info` still reports the column nullable — so `schema-drift.test.ts` keeps a permanent `KNOWN_NULLABILITY_DRIFT` entry for it.
