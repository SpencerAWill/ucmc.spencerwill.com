PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_gear` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`type_id` text NOT NULL,
	`code` text,
	`description` text NOT NULL,
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
-- Backfill any existing NULL descriptions with the gear's type name so
-- the recreate-and-copy below doesn't violate the new NOT NULL. The
-- literal 'Gear' is a belt-and-suspenders fallback for rows whose
-- type_id somehow doesn't resolve (shouldn't happen — RESTRICT FK —
-- but cheaper than risking a half-completed migration).
INSERT INTO `__new_gear`("id", "public_id", "type_id", "code", "description", "acquired_at", "acquisition_cost_cents", "notes_markdown", "lifecycle", "condition", "retired_at", "retired_by", "retired_reason", "created_by", "created_at", "updated_at") SELECT "id", "public_id", "type_id", "code", COALESCE("description", (SELECT "name" FROM `gear_types` WHERE `gear_types`."id" = `gear`."type_id"), 'Gear'), "acquired_at", "acquisition_cost_cents", "notes_markdown", "lifecycle", "condition", "retired_at", "retired_by", "retired_reason", "created_by", "created_at", "updated_at" FROM `gear`;--> statement-breakpoint
DROP TABLE `gear`;--> statement-breakpoint
ALTER TABLE `__new_gear` RENAME TO `gear`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `gear_public_id_unique` ON `gear` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_code_unique` ON `gear` (`code`);--> statement-breakpoint
CREATE INDEX `gear_type_idx` ON `gear` (`type_id`);--> statement-breakpoint
CREATE INDEX `gear_lifecycle_idx` ON `gear` (`lifecycle`);--> statement-breakpoint
CREATE INDEX `gear_condition_idx` ON `gear` (`condition`);--> statement-breakpoint
CREATE INDEX `gear_created_at_idx` ON `gear` (`created_at`);