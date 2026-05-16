-- New `display_name` column needs a DEFAULT to satisfy NOT NULL when
-- ALTERing a non-empty table. The empty default is a one-shot migration
-- artifact; subsequent inserts go through the role editor which requires
-- a non-empty display name.
ALTER TABLE `roles` ADD `display_name` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `roles` ADD `is_officer` integer DEFAULT false NOT NULL;--> statement-breakpoint

-- Curated labels for the constitutionally-seeded roles.
UPDATE `roles` SET `display_name` = 'System Admin' WHERE `id` = 'role_system_admin';--> statement-breakpoint
UPDATE `roles` SET `display_name` = 'Member'       WHERE `id` = 'role_member';--> statement-breakpoint
UPDATE `roles` SET `display_name` = 'Anonymous'    WHERE `id` = 'role_anonymous';--> statement-breakpoint
UPDATE `roles` SET `display_name` = 'Advisor'      WHERE `id` = 'role_advisor';--> statement-breakpoint
UPDATE `roles` SET `display_name` = 'President'    WHERE `id` = 'role_president';--> statement-breakpoint
UPDATE `roles` SET `display_name` = 'Treasurer'    WHERE `id` = 'role_treasurer';--> statement-breakpoint

-- Best-effort fallback for any admin-created roles not covered above:
-- capitalize the first letter of the slug and turn underscores into
-- spaces (e.g. `trip_coordinator` -> `Trip coordinator`). SQLite has no
-- INITCAP, so this only sentence-cases — admins refine via the editor.
UPDATE `roles`
SET `display_name` = UPPER(SUBSTR(`name`, 1, 1)) || REPLACE(SUBSTR(`name`, 2), '_', ' ')
WHERE `display_name` = '';
