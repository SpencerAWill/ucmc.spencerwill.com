-- Trigram FTS5 index over site-feedback submissions (`feedback`), for
-- the triage list's free-text search.
--
-- Same design as one table of 0081_search_fts.sql, which holds the
-- rationale: why trigram, why a `*_fts_keys` table giving the text id an
-- INTEGER PRIMARY KEY to use as the FTS rowid, why the update trigger
-- carries a WHEN clause, and the `wrangler d1 export` caveat. Read
-- through `searchMatches()` with `SITE_FEEDBACK_SEARCH` in
-- `src/server/db/search.ts`; not in `schema.ts`.
--
-- The triggers belong to `feedback`: a migration that rebuilds that
-- table drops them and must recreate them. `secure-delete` is on because
-- a submission can carry personal data in free text, and a deleted row's
-- trigrams should not linger in `site_feedback_fts_data`.

CREATE TABLE `site_feedback_fts_keys` (
	`id` integer PRIMARY KEY,
	`feedback_id` text NOT NULL UNIQUE
);--> statement-breakpoint
CREATE VIRTUAL TABLE `site_feedback_fts` USING fts5(
	`title`,
	`body`,
	tokenize = 'trigram'
);--> statement-breakpoint
INSERT INTO `site_feedback_fts` (`site_feedback_fts`, `rank`) VALUES ('secure-delete', 1);--> statement-breakpoint
INSERT INTO `site_feedback_fts_keys` (`feedback_id`)
SELECT `id` FROM `feedback`;--> statement-breakpoint
INSERT INTO `site_feedback_fts` (`rowid`, `title`, `body`)
SELECT k.`id`, b.`title`, b.`body`
FROM `feedback` b JOIN `site_feedback_fts_keys` k ON k.`feedback_id` = b.`id`;--> statement-breakpoint
CREATE TRIGGER `site_feedback_fts_insert` AFTER INSERT ON `feedback`
BEGIN
	INSERT INTO `site_feedback_fts_keys` (`feedback_id`) VALUES (NEW.`id`);
	INSERT INTO `site_feedback_fts` (`rowid`, `title`, `body`)
	VALUES ((SELECT `id` FROM `site_feedback_fts_keys` WHERE `feedback_id` = NEW.`id`), NEW.`title`, NEW.`body`);
END;--> statement-breakpoint
CREATE TRIGGER `site_feedback_fts_update`
AFTER UPDATE OF `id`, `title`, `body` ON `feedback`
WHEN OLD.`id` IS NOT NEW.`id` OR OLD.`title` IS NOT NEW.`title` OR OLD.`body` IS NOT NEW.`body`
BEGIN
	UPDATE `site_feedback_fts` SET `title` = NEW.`title`, `body` = NEW.`body`
	WHERE `rowid` = (SELECT `id` FROM `site_feedback_fts_keys` WHERE `feedback_id` = OLD.`id`);
	UPDATE `site_feedback_fts_keys` SET `feedback_id` = NEW.`id` WHERE `feedback_id` = OLD.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `site_feedback_fts_delete` AFTER DELETE ON `feedback`
BEGIN
	DELETE FROM `site_feedback_fts` WHERE `rowid` = (SELECT `id` FROM `site_feedback_fts_keys` WHERE `feedback_id` = OLD.`id`);
	DELETE FROM `site_feedback_fts_keys` WHERE `feedback_id` = OLD.`id`;
END;
