-- Carry the legacy auto-mirror into the triage model.
--
-- The old intake filed a GitHub issue per submission and stamped
-- `feedback.github_issue_number` / `github_issue_url` on it. Those
-- columns are now dead (nothing writes them; dropping them is a later
-- contract step) and the same facts live as one `open` issue per distinct
-- number plus a link per submission, already posted. The `feedback`
-- columns are read, never rewritten, so rollback stays code-only.
--
-- The issue takes its title, URL and timestamps from the earliest
-- submission for that number (ties broken by id). `summary_md` is NULL
-- because these issues were never drafted here.
-- Plain INSERT...SELECT: no bound parameters, and it grows with the data
-- only in rows, not in statement size.

INSERT INTO `site_feedback_issues`
	(`id`, `state`, `title`, `summary_md`, `github_number`, `github_url`, `created_at`, `updated_at`)
SELECT
	'sfi_legacy_' || f.`github_issue_number`,
	'open',
	f.`title`,
	NULL,
	f.`github_issue_number`,
	f.`github_issue_url`,
	f.`created_at`,
	f.`created_at`
FROM `feedback` f
WHERE f.`github_issue_number` IS NOT NULL
	AND f.`id` = (
		SELECT e.`id` FROM `feedback` e
		WHERE e.`github_issue_number` = f.`github_issue_number`
		ORDER BY e.`created_at`, e.`id`
		LIMIT 1
	);--> statement-breakpoint
INSERT INTO `site_feedback_issue_links`
	(`issue_id`, `feedback_id`, `quoted_md`, `posted_at`, `added_at`)
SELECT
	'sfi_legacy_' || `github_issue_number`,
	`id`,
	`body`,
	`created_at`,
	`created_at`
FROM `feedback`
WHERE `github_issue_number` IS NOT NULL;
