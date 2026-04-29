CREATE TABLE `landing_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`icon` text NOT NULL,
	`title` text NOT NULL,
	`blurb` text NOT NULL,
	`image_key` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `landing_activities_sort_idx` ON `landing_activities` (`sort_order`);--> statement-breakpoint
CREATE TABLE `landing_faq_items` (
	`id` text PRIMARY KEY NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `landing_faq_items_sort_idx` ON `landing_faq_items` (`sort_order`);--> statement-breakpoint
CREATE TABLE `landing_hero_slides` (
	`id` text PRIMARY KEY NOT NULL,
	`image_key` text NOT NULL,
	`alt` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `landing_hero_slides_sort_idx` ON `landing_hero_slides` (`sort_order`);--> statement-breakpoint
CREATE TABLE `landing_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
