CREATE TABLE `markdown_pages` (
	`slug` text PRIMARY KEY NOT NULL,
	`markdown` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

-- Carry the existing /history narrative row over from the
-- now-deprecated `history_content` table. The actual DROP TABLE
-- happens in 0051 once the application code has been switched to
-- read/write through `markdown_pages`; this lets the migration land
-- on a running deployment without losing the seeded narrative.
INSERT OR IGNORE INTO markdown_pages (slug, markdown, updated_at, updated_by)
SELECT 'history.narrative', narrative_markdown, updated_at, updated_by
FROM history_content
WHERE id = 1;
