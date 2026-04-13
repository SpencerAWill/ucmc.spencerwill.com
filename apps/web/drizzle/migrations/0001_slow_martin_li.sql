CREATE TABLE `magic_links` (
	`token` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`intent` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_id_unique` ON `sessions` (`id`);--> statement-breakpoint
CREATE TABLE `webauthn_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`challenge` text NOT NULL,
	`user_id` text,
	`expires_at` integer NOT NULL
);
