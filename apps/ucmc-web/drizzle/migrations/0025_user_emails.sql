CREATE TABLE `user_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`verified_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_emails_email_unique` ON `user_emails` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_emails_one_primary_per_user` ON `user_emails` (`user_id`) WHERE "user_emails"."is_primary" = 1;--> statement-breakpoint
CREATE INDEX `user_emails_user_id_idx` ON `user_emails` (`user_id`);--> statement-breakpoint
-- Backfill: every existing user becomes one verified primary row. The
-- existing email is de-facto verified since the user reached this row
-- by completing a magic-link round-trip during registration. Run
-- BEFORE the DROP COLUMN below or the source data is lost.
INSERT INTO `user_emails` (`id`, `user_id`, `email`, `is_primary`, `verified_at`, `created_at`)
SELECT 'uem_' || lower(hex(randomblob(16))), `id`, lower(`email`), 1, `created_at`, `created_at`
FROM `users`;--> statement-breakpoint
DROP INDEX `users_email_unique`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `email`;--> statement-breakpoint
ALTER TABLE `magic_links` ADD `target_user_id` text REFERENCES users(id) ON DELETE SET NULL;