PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`verified_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_emails`("id", "user_id", "email", "is_primary", "verified_at", "created_at") SELECT "id", "user_id", "email", "is_primary", "verified_at", "created_at" FROM `user_emails`;--> statement-breakpoint
DROP TABLE `user_emails`;--> statement-breakpoint
ALTER TABLE `__new_user_emails` RENAME TO `user_emails`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `user_emails_email_unique` ON `user_emails` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_emails_one_primary_per_user` ON `user_emails` (`user_id`) WHERE "user_emails"."is_primary" = 1;--> statement-breakpoint
CREATE INDEX `user_emails_user_id_idx` ON `user_emails` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `placeholder_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `unclaimed_at` integer;