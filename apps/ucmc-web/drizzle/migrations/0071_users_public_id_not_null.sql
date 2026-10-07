-- Enforce "users.public_id is always present" with triggers, and backfill
-- any row that lacks one (issue #233).
--
-- Hand-written, like every migration since 0060: `db:generate` cannot
-- run against the stale meta snapshots (see CLAUDE.md).
--
-- THE HOLE
-- ========
-- `0008_user_public_id` added the column, backfilled every row, and
-- built `users_public_id_unique` over it — but SQLite's ALTER TABLE ADD
-- COLUMN cannot add a NOT NULL column without a default, so the
-- constraint was never applied. `schema.ts` has claimed `.notNull()`
-- the whole time.
--
-- The unique index is not a substitute: SQLite permits unlimited NULLs
-- in a UNIQUE index, so the thing that looks like it guarantees one
-- public id per user guarantees nothing about presence. Two write paths
-- bypass Drizzle entirely — `drizzle/seed.ts` and the raw SQL in
-- `.github/workflows/seed-admin.yml` — and `public_id` is the route
-- param for `/members/$publicId` and friends, so a NULL is a 500 on a
-- member page rather than a tidiness problem.
--
-- WHY TRIGGERS AND NOT THE TABLE REBUILD #233 ASKED FOR
-- =====================================================
-- Because the rebuild cannot be done on D1. SQLite has no ALTER COLUMN,
-- so tightening a column means create-copy-drop-rename, and that is
-- only safe with `PRAGMA foreign_keys = OFF`. SQLite makes that pragma
-- a NO-OP inside a transaction, and D1 applies each migration file as
-- one implicitly transactional batch (`applyD1Migrations` does
-- `db.batch(queries)`; `wrangler d1 migrations apply` does the same).
-- D1 *accepts* `foreign_keys`, `defer_foreign_keys` and
-- `legacy_alter_table` — it just ignores them. Accepted is not honoured.
--
-- Measured, not assumed. `users` is the parent of 40 foreign key edges
-- across 28 tables, and a rebuild here reports success while:
--
--   *  7 ON DELETE CASCADE edges delete their rows outright —
--      sessions, profiles, user_roles, user_emails and the rest;
--   * 32 ON DELETE SET NULL edges silently blank their columns,
--      including both actor columns on `audit_log`, so the rows survive
--      looking perfectly fine with their attribution gone;
--   *  1 ON DELETE RESTRICT edge (`gear_loans`) aborts the migration
--      outright as soon as a single loan row exists — mid-deploy,
--      since migrations run before `wrangler deploy`.
--
-- `PRAGMA defer_foreign_keys` does not rescue it either: it defers
-- violation CHECKING to commit time, it does not suppress the cascade
-- ACTIONS. Verified all three ways in the harness.
--
-- Renaming the table out of the way first does not work either, because
-- with foreign keys live an ALTER TABLE RENAME rewrites every
-- REFERENCES clause to follow the rename — so the children track the
-- old table wherever it goes, and whatever is dropped is always the
-- thing they point at.
--
-- A trigger pair gets the guarantee that actually matters at none of
-- that risk. It is enforced by the database, so it covers the two
-- raw-SQL writers as well as Drizzle, and `RAISE(ABORT, ...)` returns
-- the same message a real constraint would.
--
-- WHAT THIS DOES NOT DO
-- =====================
-- `PRAGMA table_info` still reports the column nullable, so
-- `schema-drift.test.ts` still sees drift and its
-- KNOWN_NULLABILITY_DRIFT entry stays — with its reason rewritten from
-- "nobody has tightened it" to "enforced by trigger; a true rebuild is
-- unavailable on D1". `schema.ts` keeps `.notNull()`, which is now
-- behaviourally true: no writer can land a NULL.
--
-- Deploy-window note: migrations run before the new Worker goes live,
-- so the previous Worker briefly runs against these triggers. Benign —
-- every existing write path already supplies a public id.

-- Backfill first. The triggers below only guard future writes, and a
-- row that is already NULL would otherwise keep its broken member URL
-- forever. 12 lowercase hex characters matches the length and alphabet
-- subset of `generatePublicId()` (12 chars, [0-9a-z]). Expected to
-- touch zero rows — local dev holds 332 users and no NULLs — but a
-- backfill that finds nothing is the cheapest possible insurance.
UPDATE `users`
SET `public_id` = lower(hex(randomblob(6)))
WHERE `public_id` IS NULL;--> statement-breakpoint

-- Guard the insert path. `WHEN NEW.public_id IS NULL` also catches an
-- INSERT that omits the column entirely, which is the shape both
-- raw-SQL writers would take if someone dropped the column from their
-- statement.
CREATE TRIGGER `users_public_id_not_null_insert`
BEFORE INSERT ON `users`
FOR EACH ROW WHEN NEW.`public_id` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'NOT NULL constraint failed: users.public_id');
END;--> statement-breakpoint

-- Guard the update path separately. `BEFORE UPDATE OF public_id` fires
-- only when that column is assigned, so an unrelated UPDATE on the row
-- costs nothing.
CREATE TRIGGER `users_public_id_not_null_update`
BEFORE UPDATE OF `public_id` ON `users`
FOR EACH ROW WHEN NEW.`public_id` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'NOT NULL constraint failed: users.public_id');
END;
