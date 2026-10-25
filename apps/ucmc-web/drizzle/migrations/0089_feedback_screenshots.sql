ALTER TABLE `feedback` ADD `screenshot_key` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `screenshot_bytes` integer;--> statement-breakpoint
ALTER TABLE `feedback` ADD `screenshot_purged_at` integer;--> statement-breakpoint
ALTER TABLE `feedback` ADD `status_changed_at` integer;--> statement-breakpoint
ALTER TABLE `site_feedback_issues` ADD `closed_at` integer;