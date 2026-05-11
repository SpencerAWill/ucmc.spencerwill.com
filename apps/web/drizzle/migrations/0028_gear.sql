CREATE TABLE `gear` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`type_id` text NOT NULL,
	`code` text,
	`description` text,
	`acquired_at` integer,
	`acquisition_cost_cents` integer,
	`notes_markdown` text,
	`lifecycle` text DEFAULT 'active' NOT NULL,
	`condition` text DEFAULT 'serviceable' NOT NULL,
	`retired_at` integer,
	`retired_by` text,
	`retired_reason` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`type_id`) REFERENCES `gear_types`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`retired_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gear_public_id_unique` ON `gear` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_code_unique` ON `gear` (`code`);--> statement-breakpoint
CREATE INDEX `gear_type_idx` ON `gear` (`type_id`);--> statement-breakpoint
CREATE INDEX `gear_lifecycle_idx` ON `gear` (`lifecycle`);--> statement-breakpoint
CREATE INDEX `gear_condition_idx` ON `gear` (`condition`);--> statement-breakpoint
CREATE INDEX `gear_created_at_idx` ON `gear` (`created_at`);--> statement-breakpoint
CREATE TABLE `gear_tag_assignments` (
	`gear_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`assigned_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`assigned_by` text,
	PRIMARY KEY(`gear_id`, `tag_id`),
	FOREIGN KEY (`gear_id`) REFERENCES `gear`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `gear_tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `gear_tag_assignments_tag_idx` ON `gear_tag_assignments` (`tag_id`);--> statement-breakpoint
CREATE TABLE `gear_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gear_tags_public_id_unique` ON `gear_tags` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_tags_name_unique` ON `gear_tags` (`name`);--> statement-breakpoint
CREATE TABLE `gear_types` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text,
	`description` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gear_types_public_id_unique` ON `gear_types` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_types_name_unique` ON `gear_types` (`name`);