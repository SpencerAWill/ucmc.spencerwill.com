CREATE TABLE `historical_officers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`school_year` text NOT NULL,
	`start_year` integer NOT NULL,
	`role` text NOT NULL,
	`role_order` integer NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `historical_officers_year_idx` ON `historical_officers` (`start_year`,`role_order`);--> statement-breakpoint
CREATE TABLE `honorary_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `honorary_members_sort_idx` ON `honorary_members` (`sort_order`);