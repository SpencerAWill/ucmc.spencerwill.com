CREATE TABLE `banned_emails` (
	`email` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`banned_at` integer NOT NULL,
	`banned_by` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `banned_emails_user_id_idx` ON `banned_emails` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `banned_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `banned_by` text;--> statement-breakpoint
ALTER TABLE `users` ADD `banned_reason` text;