-- Gear inventory rework: the model layer, coded-vs-counted tracking, and
-- the three-axis state split (issue: gear page redesign).
--
-- This is a **drop and recreate**, not a data migration. Prod has no gear
-- rows at all and the dev database holds only throwaway test data, so
-- preserving either would cost more care than the data is worth. If that
-- ever stops being true, this migration is NOT safe to re-run — it drops
-- every gear table including tags and types.
--
-- What changes, and why:
--
--   * `gear` becomes `gear_items`, sitting under a new `gear_models`
--     layer which sits under the existing `gear_types`. The cave owns
--     fleets (forty quickdraws, twelve of one harness), so manufacturer,
--     MSRP, service life and the product photo belonged on the product,
--     not retyped onto every unit. This is also what makes "7 of 12
--     available" and recall-matching answerable at all.
--
--   * `gear_models.tracking` splits coded from counted. Quickdraws and
--     pre-cut slings carry no labels — the desk hands out six and counts
--     six back — so a counted model has no item rows and keeps quantities
--     in `gear_stock_levels` instead. Giving each draw a row anyway was
--     fake precision: when five of six come back, nothing knows which one
--     is gone.
--
--   * The old `lifecycle` + `condition` pair becomes three independent
--     columns: `status` (is it still ours), `condition` (can it be
--     loaned), `whereabouts` (where is it). The old shape could not
--     express "missing AND needs_repair", and had nowhere at all to say
--     "fine, but at the repair shop".
--
--   * `gear.code` is no longer recycled. Retiring used to NULL it; now it
--     stays bound to its item forever, so every historical mention of
--     "CH93" resolves to exactly one item. Freeing a code is an explicit,
--     audited action on an already-retired item.
--
--   * `condition_grade` is dropped — an undated, unattributed, optional
--     opinion on a three-point scale with no bottom rung. `gear_inspections`
--     records the same judgement dated and attributed.
--
--   * `retired_at` / `retired_by` / `retired_reason` become
--     `deactivated_*`: `lost` and `disposed` are terminal too, so the old
--     names lied about three of the four cases.
--
-- New surfaces (holds, inventory sweeps, custom attributes) ride on
-- `gear:manage` rather than introducing permissions of their own. They are
-- all officer tools over the same inventory, and a permission is a DB row
-- plus a seed plus a role grant — worth spending when a surface can be
-- delegated separately, which none of these can.

-- ── drop, in foreign-key order ─────────────────────────────────────────
DROP TABLE IF EXISTS `gear_loans`;--> statement-breakpoint
DROP TABLE IF EXISTS `gear_tag_assignments`;--> statement-breakpoint
DROP TABLE IF EXISTS `gear_inspections`;--> statement-breakpoint
DROP TABLE IF EXISTS `gear_tags`;--> statement-breakpoint
DROP TABLE IF EXISTS `gear`;--> statement-breakpoint
DROP TABLE IF EXISTS `gear_types`;--> statement-breakpoint

-- ── types: the browse category ────────────────────────────────────────
CREATE TABLE `gear_types` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text,
	`description` text,
	`inspection_interval_days` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_types_public_id_unique` ON `gear_types` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_types_name_unique` ON `gear_types` (`name`);--> statement-breakpoint

-- ── models: the product ───────────────────────────────────────────────
CREATE TABLE `gear_models` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`type_id` text NOT NULL,
	`manufacturer` text,
	`name` text NOT NULL,
	`tracking` text DEFAULT 'coded' NOT NULL,
	`description` text,
	`msrp_cents` integer,
	`service_life_years` integer,
	`inspection_interval_days` integer,
	`image_key` text,
	`product_url` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`type_id`) REFERENCES `gear_types`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_models_public_id_unique` ON `gear_models` (`public_id`);--> statement-breakpoint
CREATE INDEX `gear_models_type_idx` ON `gear_models` (`type_id`);--> statement-breakpoint
CREATE INDEX `gear_models_tracking_idx` ON `gear_models` (`tracking`);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_models_type_manufacturer_name_unique` ON `gear_models` (`type_id`,`manufacturer`,`name`);--> statement-breakpoint

-- ── items: one physical unit (coded models only) ──────────────────────
CREATE TABLE `gear_items` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`model_id` text NOT NULL,
	`code` text,
	`serial_number` text,
	`description` text,
	`thumbnail_key` text,
	`manufactured_at` integer,
	`acquired_at` integer,
	`acquisition_cost_cents` integer,
	`acquisition_kind` text,
	`notes_markdown` text,
	`status` text DEFAULT 'active' NOT NULL,
	`condition` text DEFAULT 'serviceable' NOT NULL,
	`whereabouts` text DEFAULT 'cave' NOT NULL,
	`whereabouts_as_of` integer,
	`whereabouts_note` text,
	`deactivated_at` integer,
	`deactivated_by` text,
	`deactivated_reason` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `gear_models`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`deactivated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_items_public_id_unique` ON `gear_items` (`public_id`);--> statement-breakpoint
-- Plain UNIQUE, relying on SQLite's multiple-NULLs-allowed semantics so
-- an unlabelled fresh-in-box item is legal. Codes are never recycled, so
-- unlike the old `gear_code_unique` this constraint now genuinely binds a
-- code to one item for the life of the database.
CREATE UNIQUE INDEX `gear_items_code_unique` ON `gear_items` (`code`);--> statement-breakpoint
CREATE INDEX `gear_items_model_idx` ON `gear_items` (`model_id`);--> statement-breakpoint
CREATE INDEX `gear_items_status_idx` ON `gear_items` (`status`);--> statement-breakpoint
CREATE INDEX `gear_items_condition_idx` ON `gear_items` (`condition`);--> statement-breakpoint
CREATE INDEX `gear_items_whereabouts_idx` ON `gear_items` (`whereabouts`);--> statement-breakpoint
CREATE INDEX `gear_items_created_at_idx` ON `gear_items` (`created_at`);--> statement-breakpoint

-- ── stock: counted models only ────────────────────────────────────────
-- Quantity is everything owned in that condition bucket, INCLUDING units
-- currently on loan. Available is computed at read time as
-- quantity - open loan quantity, so a crashed checkout can't leave a
-- stored "available" disagreeing with the loan table.
CREATE TABLE `gear_stock_levels` (
	`model_id` text NOT NULL,
	`condition` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`model_id`, `condition`),
	FOREIGN KEY (`model_id`) REFERENCES `gear_models`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint

-- ── tags: cross-cutting labels only ───────────────────────────────────
CREATE TABLE `gear_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_tags_public_id_unique` ON `gear_tags` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_tags_name_unique` ON `gear_tags` (`name`);--> statement-breakpoint

CREATE TABLE `gear_tag_assignments` (
	`item_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`assigned_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`assigned_by` text,
	PRIMARY KEY(`item_id`, `tag_id`),
	FOREIGN KEY (`item_id`) REFERENCES `gear_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `gear_tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `gear_tag_assignments_tag_idx` ON `gear_tag_assignments` (`tag_id`);--> statement-breakpoint

-- ── custom attributes, at two levels ──────────────────────────────────
-- `level` is what makes seeding cheap: a model-level attribute (rope
-- diameter) is typed once for a fleet of forty; an item-level one
-- (harness size) varies per unit. A counted model has no items, so only
-- model-level values can exist for it — that falls out of the shape.
CREATE TABLE `gear_attribute_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`level` text NOT NULL,
	`options` text,
	`unit` text,
	`required` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_attribute_defs_public_id_unique` ON `gear_attribute_defs` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_attribute_defs_key_unique` ON `gear_attribute_defs` (`key`);--> statement-breakpoint

CREATE TABLE `gear_attribute_def_types` (
	`def_id` text NOT NULL,
	`type_id` text NOT NULL,
	PRIMARY KEY(`def_id`, `type_id`),
	FOREIGN KEY (`def_id`) REFERENCES `gear_attribute_defs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`type_id`) REFERENCES `gear_types`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `gear_attribute_def_types_type_idx` ON `gear_attribute_def_types` (`type_id`);--> statement-breakpoint

CREATE TABLE `gear_model_attribute_values` (
	`model_id` text NOT NULL,
	`def_id` text NOT NULL,
	`value_text` text,
	`value_number` integer,
	PRIMARY KEY(`model_id`, `def_id`),
	FOREIGN KEY (`model_id`) REFERENCES `gear_models`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`def_id`) REFERENCES `gear_attribute_defs`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `gear_model_attribute_values_def_idx` ON `gear_model_attribute_values` (`def_id`,`value_text`);--> statement-breakpoint

CREATE TABLE `gear_item_attribute_values` (
	`item_id` text NOT NULL,
	`def_id` text NOT NULL,
	`value_text` text,
	`value_number` integer,
	PRIMARY KEY(`item_id`, `def_id`),
	FOREIGN KEY (`item_id`) REFERENCES `gear_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`def_id`) REFERENCES `gear_attribute_defs`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `gear_item_attribute_values_def_idx` ON `gear_item_attribute_values` (`def_id`,`value_text`);--> statement-breakpoint

-- ── inspections: per item, or per model for counted stock ─────────────
CREATE TABLE `gear_inspections` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`item_id` text,
	`model_id` text,
	`inspector_user_id` text,
	`inspector_name_snapshot` text,
	`inspected_at` integer NOT NULL,
	`result` text NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `gear_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `gear_models`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inspector_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_inspections_public_id_unique` ON `gear_inspections` (`public_id`);--> statement-breakpoint
CREATE INDEX `gear_inspections_item_idx` ON `gear_inspections` (`item_id`);--> statement-breakpoint
CREATE INDEX `gear_inspections_model_idx` ON `gear_inspections` (`model_id`);--> statement-breakpoint
CREATE INDEX `gear_inspections_item_inspected_idx` ON `gear_inspections` (`item_id`,`inspected_at`);--> statement-breakpoint

-- ── loans: dual shape ─────────────────────────────────────────────────
-- A coded loan sets `item_id` and leaves quantity 1; a counted loan sets
-- `model_id` and a real quantity ("six draws"). The CHECK enforces
-- exactly one. Two near-identical tables were the alternative, and would
-- have meant two of every query behind /my/gear, the overdue list and
-- member standing.
CREATE TABLE `gear_loans` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`item_id` text,
	`model_id` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`quantity_returned` integer DEFAULT 0 NOT NULL,
	`member_user_id` text NOT NULL,
	`checked_out_by_user_id` text,
	`checked_out_at` integer NOT NULL,
	`due_at` integer NOT NULL,
	`returned_at` integer,
	`returned_to_user_id` text,
	`checkout_notes` text,
	`checkin_notes` text,
	`condition_at_return` text,
	`quantity_lost` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `gear_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`model_id`) REFERENCES `gear_models`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`member_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`checked_out_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`returned_to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `gear_loans_item_xor_model` CHECK ((`item_id` IS NOT NULL) <> (`model_id` IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_loans_public_id_unique` ON `gear_loans` (`public_id`);--> statement-breakpoint
-- Race-protective: only one open loan per coded item at any moment. This
-- index, not the action's pre-check, is what wins a race between two
-- officers checking out the same harness. Counted stock has no equivalent
-- — it is guarded by an available-quantity read-then-write that can
-- over-lend by one under a true tie, which the cave prefers to a lock.
CREATE UNIQUE INDEX `gear_loans_one_active_per_item` ON `gear_loans` (`item_id`) WHERE `returned_at` IS NULL;--> statement-breakpoint
CREATE INDEX `gear_loans_member_returned_idx` ON `gear_loans` (`member_user_id`,`returned_at`);--> statement-breakpoint
CREATE INDEX `gear_loans_item_idx` ON `gear_loans` (`item_id`);--> statement-breakpoint
CREATE INDEX `gear_loans_model_idx` ON `gear_loans` (`model_id`);--> statement-breakpoint
CREATE INDEX `gear_loans_due_idx` ON `gear_loans` (`due_at`);--> statement-breakpoint

-- ── holds: officer reservations ───────────────────────────────────────
-- A hold is intent, not a property of the object — it has a placer, a
-- reason and an expiry no enum value could carry, and it must coexist
-- with `needs_repair` and with an open loan (due back the 5th, held for
-- the 12th). Auto-release is evaluated at read time against `ends_at`,
-- so there is no cron; the manage UI lists expired-but-unreleased holds
-- so stale reservations surface rather than rot.
CREATE TABLE `gear_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`item_id` text,
	`model_id` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`reason` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`released_at` integer,
	`released_by_user_id` text,
	`held_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `gear_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `gear_models`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`released_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`held_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `gear_holds_item_xor_model` CHECK ((`item_id` IS NOT NULL) <> (`model_id` IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_holds_public_id_unique` ON `gear_holds` (`public_id`);--> statement-breakpoint
CREATE INDEX `gear_holds_item_idx` ON `gear_holds` (`item_id`);--> statement-breakpoint
CREATE INDEX `gear_holds_model_idx` ON `gear_holds` (`model_id`);--> statement-breakpoint
CREATE INDEX `gear_holds_window_idx` ON `gear_holds` (`ends_at`,`released_at`);--> statement-breakpoint

-- ── inventory sweeps ──────────────────────────────────────────────────
-- Presence is recorded; absence is inferred at close. That is the whole
-- reason sweeps are an entity rather than a per-item checkbox, and it is
-- where `whereabouts = 'missing'` and its `whereabouts_as_of` date come
-- from. Several people scan into one open sweep, so `seen_by_user_id`
-- lives on the entry, not the sweep.
CREATE TABLE `gear_inventory_sweeps` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_by_user_id` text,
	`closed_at` integer,
	`closed_by_user_id` text,
	`notes` text,
	FOREIGN KEY (`started_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`closed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_inventory_sweeps_public_id_unique` ON `gear_inventory_sweeps` (`public_id`);--> statement-breakpoint
CREATE INDEX `gear_inventory_sweeps_closed_idx` ON `gear_inventory_sweeps` (`closed_at`);--> statement-breakpoint

CREATE TABLE `gear_inventory_sweep_entries` (
	`sweep_id` text NOT NULL,
	`item_id` text,
	`model_id` text,
	`quantity_counted` integer DEFAULT 1 NOT NULL,
	`seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`seen_by_user_id` text,
	FOREIGN KEY (`sweep_id`) REFERENCES `gear_inventory_sweeps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `gear_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `gear_models`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seen_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `gear_sweep_entries_item_xor_model` CHECK ((`item_id` IS NOT NULL) <> (`model_id` IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX `gear_inventory_sweep_entries_sweep_idx` ON `gear_inventory_sweep_entries` (`sweep_id`);--> statement-breakpoint
-- Two partial-by-NULL uniques rather than one composite: an entry names
-- either an item or a model, and SQLite's multiple-NULLs semantics makes
-- each index apply only to the rows of its own kind.
CREATE UNIQUE INDEX `gear_inventory_sweep_entries_sweep_item_unique` ON `gear_inventory_sweep_entries` (`sweep_id`,`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_inventory_sweep_entries_sweep_model_unique` ON `gear_inventory_sweep_entries` (`sweep_id`,`model_id`);
