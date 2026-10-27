---
paths:
  - "apps/ucmc-web/drizzle/**"
  - "apps/ucmc-web/scripts/check-migration-drift.ts"
  - "apps/ucmc-web/src/server/db/__tests__/**"
---

# Writing D1 migrations

Why every migration goes through `generate`, why pragmas don't work, and why migrations only add: `docs/adr/0007-every-migration-through-generate.md`. Part of the data rule; `data/core.md` covers bindings and the parameter limit.

## Where things go

- **`db:generate --name <what_it_does>`** for DDL Drizzle derives from `schema.ts`; **`db:generate --custom --name <what_it_does>`** for an empty file to write SQL into. Both write the journal entry **and** `meta/NNNN_snapshot.json`.
- **`db:drift`** (`scripts/check-migration-drift.ts`, in `pnpm verify` and CI's web job) runs `generate` on a temp copy and fails if it would write anything, if a `.sql` file and a journal entry don't pair up, if an entry from `0084` on has no snapshot, or on any stderr (drizzle-kit 0.31 exits 0 on its rename-prompt error).
- **`schema-drift.test.ts`** checks `schema.ts` against the real database, with `KNOWN_NULLABILITY_DRIFT` for intended differences.

## Rules that are easy to break

- **Never write a migration file or a journal entry by hand.** `0060`–`0083` were, and have no snapshots; `0084_snapshot.json` restarted the chain.
- **A rename prompt is answered by running `db:generate` in a terminal**, not by editing files.
- **Give a `--custom` file the explanatory header** the hand-written ones carry.
- **The snapshot follows `schema.ts`, not the database**, where they knowingly differ: `users.public_id` (nullable in D1, trigger-enforced), `roles.display_name` (`DEFAULT ''` in D1 only), the FTS5 tables and triggers. Recording the database's version makes the next `generate` emit a rebuild.
- **Migrations only add.** Old code runs on the new schema during each deploy, prod migrates after dev, and rollback is code-only.
- **Review generated DDL like hand-written.** A nullability or constraint change comes out as create-copy-drop-rename.
- **`PRAGMA foreign_keys`, `defer_foreign_keys` and `legacy_alter_table` are silently ignored inside a migration** (each file is one implicit transaction). `0026` and `0030` open with `PRAGMA foreign_keys=OFF` and worked only because the tables they rebuilt (`user_emails`, `gear`) have no children; don't copy that onto a referenced table.
- **Never rebuild a referenced table.** On `users` (40 FK edges across 28 tables) a rebuild completes without error while 7 `CASCADE` edges delete rows, 32 `SET NULL` edges blank columns (including `audit_log`'s actors), and 1 `RESTRICT` edge (`gear_loans`) aborts the migration once a loan exists. Renaming the parent out of the way doesn't help: `ALTER TABLE … RENAME` rewrites every `REFERENCES` to follow it.

## Adding things

- **A constraint on a column of a referenced table** is a `BEFORE INSERT` / `BEFORE UPDATE OF` trigger pair that `RAISE(ABORT, …)`s with the message the real constraint would give. It covers writers that bypass Drizzle (`drizzle/seed.ts`, `seed-admin.yml`'s SQL). `0071_users_public_id_not_null.sql` is the worked example; add a `KNOWN_NULLABILITY_DRIFT` entry, since `PRAGMA table_info` still reports the column nullable.
- **A rename of anything looked up by string** (permission, setting key, hero key) follows the `rename-permission-or-setting` skill.
