CREATE TABLE `gear_inspections` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`gear_id` text NOT NULL,
	`inspector_user_id` text,
	`inspector_name_snapshot` text,
	`inspected_at` integer NOT NULL,
	`result` text NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`gear_id`) REFERENCES `gear`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inspector_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gear_inspections_public_id_unique` ON `gear_inspections` (`public_id`);--> statement-breakpoint
CREATE INDEX `gear_inspections_gear_idx` ON `gear_inspections` (`gear_id`);--> statement-breakpoint
CREATE INDEX `gear_inspections_gear_inspected_idx` ON `gear_inspections` (`gear_id`,`inspected_at`);