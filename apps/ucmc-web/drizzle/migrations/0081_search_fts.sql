-- Trigram FTS5 indexes for free-text search (issue #189).
--
-- Hand-written, like every migration since 0060: `db:generate` cannot
-- run against the stale meta snapshots (see CLAUDE.md). Drizzle has no
-- notion of a virtual table either, so none of these appear in
-- `schema.ts`; they are read through `searchMatches()` in
-- `src/server/db/search.ts`, which is the only thing that names them.
--
-- WHY
-- ===
-- Every search went through `likeContains()`, a `%needle%` LIKE. The
-- leading wildcard means SQLite cannot use an index, so each search was
-- a full scan with a LIKE evaluated per row — measured on #189 at 10x
-- club scale (5k members, 25k loans) as ~30 ms of D1 time and a row
-- read per member, per item and per loan on every keystroke that
-- reached the server.
--
-- WHY TRIGRAM, NOT THE DEFAULT TOKENIZER
-- ======================================
-- `unicode61` (the default) matches words and word prefixes: "mith"
-- would stop finding "Smith", and "H93" would stop finding "CH93". The
-- `trigram` tokenizer indexes every three-character window instead, so
-- a quoted MATCH is a case-insensitive SUBSTRING match — the semantics
-- LIKE had, now through an index. Two differences, both accepted:
--
--   * A needle under three characters cannot be looked up (it has no
--     trigram). `searchMatches()` falls back to LIKE over the FTS
--     table's own columns for those, so a two-letter search still works,
--     as a scan of the (narrow) index table rather than the base table.
--   * From three characters up, case folding is Unicode-aware — "ébert"
--     finds "Ébert". The under-three fallback is SQLite's LIKE, which
--     folds ASCII only, so "éb" still misses it. That is exactly the
--     behaviour every needle had before, and SQLite has no Unicode
--     `lower()` without ICU to make the two paths agree.
--
-- WHY A KEY TABLE BESIDE EACH INDEX
-- ==================================
-- An FTS5 row is addressed by an integer rowid, and every trigger has
-- to find the entry for one base row. None of the base tables has an
-- INTEGER PRIMARY KEY — they are keyed by text ids — so:
--
--   * External content (`content='profiles'`) would key on the implicit
--     rowid, which SQLite is free to renumber on VACUUM and which a
--     create-copy-drop-rename rebuild renumbers outright. The index then
--     returns the WRONG ROWS, silently.
--   * Storing the text id in the FTS table as an UNINDEXED column is
--     correct but unindexed: each
--     trigger's `DELETE … WHERE user_id = OLD.user_id` scans the whole
--     FTS table, and a retention sweep deleting N users in one statement
--     fires it N times — quadratic, on the cron path.
--
-- So each index has a plain `*_fts_keys` table mapping the text id to
-- an INTEGER PRIMARY KEY, and that integer is the FTS rowid. An INTEGER
-- PRIMARY KEY is the rowid itself and is never renumbered, every trigger
-- becomes a point lookup by unique text id then by rowid, and a search
-- joins its matches back through the same table. The FTS tables hold
-- only the searched text. Neither the key tables nor the FTS tables are
-- in `schema.ts`; `src/server/db/search.ts` is the only code naming them.
--
-- Update triggers carry a WHEN clause because the profile and detail
-- forms SET every column on every save: without it a phone-number edit
-- would rewrite the member's index entry for nothing.
--
-- WHAT THIS COMMITS FUTURE MIGRATIONS TO
-- ======================================
-- Triggers belong to their table. A migration that rebuilds `profiles`,
-- `user_emails`, `gear_items` or `gear_models` drops these triggers
-- with it and must recreate them; `search-fts.test.ts` asserts every
-- one exists, so forgetting fails the suite rather than letting the
-- index drift quietly.
--
-- SECURE-DELETE ON THE TWO TABLES HOLDING PERSONAL DATA
-- ====================================================
-- FTS5's default delete does not remove a row's tokens from the index:
-- it appends a delete marker and leaves the original entries in their
-- segment until a later merge happens to rewrite it. For member names
-- and email addresses that means text the retention sweeps and an
-- account deletion have removed from the base table would linger in
-- `*_fts_data`, reconstructible from its trigrams, for an unbounded
-- time. `secure-delete` (SQLite 3.42+) removes the entries in place. It
-- makes deletes somewhat dearer, which at a few a day costs nothing.
-- Gear prose is not personal data and keeps the default.
--
-- Note also that `wrangler d1 export` does not support databases
-- containing virtual tables. Nothing here uses export (Time Travel is
-- the recovery path and is unaffected), but anyone reaching for it will
-- need to drop the four FTS tables and empty their `*_fts_keys` tables
-- first, then re-run the backfill statements below afterwards.

-- ── member names ──────────────────────────────────────────────────────
CREATE TABLE `profiles_fts_keys` (
	`id` integer PRIMARY KEY,
	`user_id` text NOT NULL UNIQUE
);--> statement-breakpoint
CREATE VIRTUAL TABLE `profiles_fts` USING fts5(
	`full_name`,
	`preferred_name`,
	tokenize = 'trigram'
);--> statement-breakpoint
INSERT INTO `profiles_fts` (`profiles_fts`, `rank`) VALUES ('secure-delete', 1);--> statement-breakpoint
INSERT INTO `profiles_fts_keys` (`user_id`)
SELECT `user_id` FROM `profiles`;--> statement-breakpoint
INSERT INTO `profiles_fts` (`rowid`, `full_name`, `preferred_name`)
SELECT k.`id`, b.`full_name`, b.`preferred_name`
FROM `profiles` b JOIN `profiles_fts_keys` k ON k.`user_id` = b.`user_id`;--> statement-breakpoint
CREATE TRIGGER `profiles_fts_insert` AFTER INSERT ON `profiles`
BEGIN
	INSERT INTO `profiles_fts_keys` (`user_id`) VALUES (NEW.`user_id`);
	INSERT INTO `profiles_fts` (`rowid`, `full_name`, `preferred_name`)
	VALUES ((SELECT `id` FROM `profiles_fts_keys` WHERE `user_id` = NEW.`user_id`), NEW.`full_name`, NEW.`preferred_name`);
END;--> statement-breakpoint
CREATE TRIGGER `profiles_fts_update`
AFTER UPDATE OF `user_id`, `full_name`, `preferred_name` ON `profiles`
WHEN OLD.`user_id` IS NOT NEW.`user_id` OR OLD.`full_name` IS NOT NEW.`full_name` OR OLD.`preferred_name` IS NOT NEW.`preferred_name`
BEGIN
	UPDATE `profiles_fts` SET `full_name` = NEW.`full_name`, `preferred_name` = NEW.`preferred_name`
	WHERE `rowid` = (SELECT `id` FROM `profiles_fts_keys` WHERE `user_id` = OLD.`user_id`);
	UPDATE `profiles_fts_keys` SET `user_id` = NEW.`user_id` WHERE `user_id` = OLD.`user_id`;
END;--> statement-breakpoint
CREATE TRIGGER `profiles_fts_delete` AFTER DELETE ON `profiles`
BEGIN
	DELETE FROM `profiles_fts` WHERE `rowid` = (SELECT `id` FROM `profiles_fts_keys` WHERE `user_id` = OLD.`user_id`);
	DELETE FROM `profiles_fts_keys` WHERE `user_id` = OLD.`user_id`;
END;--> statement-breakpoint

-- ── member emails ─────────────────────────────────────────────────────
-- Keyed by both ids: the directory matches any of a member's addresses
-- (by `user_id`), while the loan desk searches the primary only and so
-- joins back through `email_id`.
CREATE TABLE `user_emails_fts_keys` (
	`id` integer PRIMARY KEY,
	`email_id` text NOT NULL UNIQUE,
	`user_id` text NOT NULL
);--> statement-breakpoint
CREATE VIRTUAL TABLE `user_emails_fts` USING fts5(
	`email`,
	tokenize = 'trigram'
);--> statement-breakpoint
INSERT INTO `user_emails_fts` (`user_emails_fts`, `rank`) VALUES ('secure-delete', 1);--> statement-breakpoint
INSERT INTO `user_emails_fts_keys` (`email_id`, `user_id`)
SELECT `id`, `user_id` FROM `user_emails`;--> statement-breakpoint
INSERT INTO `user_emails_fts` (`rowid`, `email`)
SELECT k.`id`, b.`email`
FROM `user_emails` b JOIN `user_emails_fts_keys` k ON k.`email_id` = b.`id`;--> statement-breakpoint
CREATE TRIGGER `user_emails_fts_insert` AFTER INSERT ON `user_emails`
BEGIN
	INSERT INTO `user_emails_fts_keys` (`email_id`, `user_id`) VALUES (NEW.`id`, NEW.`user_id`);
	INSERT INTO `user_emails_fts` (`rowid`, `email`)
	VALUES ((SELECT `id` FROM `user_emails_fts_keys` WHERE `email_id` = NEW.`id`), NEW.`email`);
END;--> statement-breakpoint
CREATE TRIGGER `user_emails_fts_update`
AFTER UPDATE OF `id`, `user_id`, `email` ON `user_emails`
WHEN OLD.`id` IS NOT NEW.`id` OR OLD.`user_id` IS NOT NEW.`user_id` OR OLD.`email` IS NOT NEW.`email`
BEGIN
	UPDATE `user_emails_fts` SET `email` = NEW.`email`
	WHERE `rowid` = (SELECT `id` FROM `user_emails_fts_keys` WHERE `email_id` = OLD.`id`);
	UPDATE `user_emails_fts_keys` SET `email_id` = NEW.`id`, `user_id` = NEW.`user_id` WHERE `email_id` = OLD.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `user_emails_fts_delete` AFTER DELETE ON `user_emails`
BEGIN
	DELETE FROM `user_emails_fts` WHERE `rowid` = (SELECT `id` FROM `user_emails_fts_keys` WHERE `email_id` = OLD.`id`);
	DELETE FROM `user_emails_fts_keys` WHERE `email_id` = OLD.`id`;
END;--> statement-breakpoint

-- ── gear item notes ───────────────────────────────────────────────────
-- `code` is deliberately NOT here: officers type partial codes off a
-- tag, codes are often under three characters of distinguishing text
-- ("LJ4"), and the table is small enough that `likeContains` on it is
-- free. Rows with no notes are still indexed (as NULL) so the triggers
-- never have to reason about whether an entry exists.
CREATE TABLE `gear_items_fts_keys` (
	`id` integer PRIMARY KEY,
	`item_id` text NOT NULL UNIQUE
);--> statement-breakpoint
CREATE VIRTUAL TABLE `gear_items_fts` USING fts5(
	`notes_markdown`,
	tokenize = 'trigram'
);--> statement-breakpoint
INSERT INTO `gear_items_fts_keys` (`item_id`)
SELECT `id` FROM `gear_items`;--> statement-breakpoint
INSERT INTO `gear_items_fts` (`rowid`, `notes_markdown`)
SELECT k.`id`, b.`notes_markdown`
FROM `gear_items` b JOIN `gear_items_fts_keys` k ON k.`item_id` = b.`id`;--> statement-breakpoint
CREATE TRIGGER `gear_items_fts_insert` AFTER INSERT ON `gear_items`
BEGIN
	INSERT INTO `gear_items_fts_keys` (`item_id`) VALUES (NEW.`id`);
	INSERT INTO `gear_items_fts` (`rowid`, `notes_markdown`)
	VALUES ((SELECT `id` FROM `gear_items_fts_keys` WHERE `item_id` = NEW.`id`), NEW.`notes_markdown`);
END;--> statement-breakpoint
CREATE TRIGGER `gear_items_fts_update`
AFTER UPDATE OF `id`, `notes_markdown` ON `gear_items`
WHEN OLD.`id` IS NOT NEW.`id` OR OLD.`notes_markdown` IS NOT NEW.`notes_markdown`
BEGIN
	UPDATE `gear_items_fts` SET `notes_markdown` = NEW.`notes_markdown`
	WHERE `rowid` = (SELECT `id` FROM `gear_items_fts_keys` WHERE `item_id` = OLD.`id`);
	UPDATE `gear_items_fts_keys` SET `item_id` = NEW.`id` WHERE `item_id` = OLD.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `gear_items_fts_delete` AFTER DELETE ON `gear_items`
BEGIN
	DELETE FROM `gear_items_fts` WHERE `rowid` = (SELECT `id` FROM `gear_items_fts_keys` WHERE `item_id` = OLD.`id`);
	DELETE FROM `gear_items_fts_keys` WHERE `item_id` = OLD.`id`;
END;--> statement-breakpoint

-- ── gear models ───────────────────────────────────────────────────────
CREATE TABLE `gear_models_fts_keys` (
	`id` integer PRIMARY KEY,
	`model_id` text NOT NULL UNIQUE
);--> statement-breakpoint
CREATE VIRTUAL TABLE `gear_models_fts` USING fts5(
	`manufacturer`,
	`name`,
	tokenize = 'trigram'
);--> statement-breakpoint
INSERT INTO `gear_models_fts_keys` (`model_id`)
SELECT `id` FROM `gear_models`;--> statement-breakpoint
INSERT INTO `gear_models_fts` (`rowid`, `manufacturer`, `name`)
SELECT k.`id`, b.`manufacturer`, b.`name`
FROM `gear_models` b JOIN `gear_models_fts_keys` k ON k.`model_id` = b.`id`;--> statement-breakpoint
CREATE TRIGGER `gear_models_fts_insert` AFTER INSERT ON `gear_models`
BEGIN
	INSERT INTO `gear_models_fts_keys` (`model_id`) VALUES (NEW.`id`);
	INSERT INTO `gear_models_fts` (`rowid`, `manufacturer`, `name`)
	VALUES ((SELECT `id` FROM `gear_models_fts_keys` WHERE `model_id` = NEW.`id`), NEW.`manufacturer`, NEW.`name`);
END;--> statement-breakpoint
CREATE TRIGGER `gear_models_fts_update`
AFTER UPDATE OF `id`, `manufacturer`, `name` ON `gear_models`
WHEN OLD.`id` IS NOT NEW.`id` OR OLD.`manufacturer` IS NOT NEW.`manufacturer` OR OLD.`name` IS NOT NEW.`name`
BEGIN
	UPDATE `gear_models_fts` SET `manufacturer` = NEW.`manufacturer`, `name` = NEW.`name`
	WHERE `rowid` = (SELECT `id` FROM `gear_models_fts_keys` WHERE `model_id` = OLD.`id`);
	UPDATE `gear_models_fts_keys` SET `model_id` = NEW.`id` WHERE `model_id` = OLD.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `gear_models_fts_delete` AFTER DELETE ON `gear_models`
BEGIN
	DELETE FROM `gear_models_fts` WHERE `rowid` = (SELECT `id` FROM `gear_models_fts_keys` WHERE `model_id` = OLD.`id`);
	DELETE FROM `gear_models_fts_keys` WHERE `model_id` = OLD.`id`;
END;
