-- Add a position column to roles for explicit ordering in the admin UI.
-- Protected roles get fixed positions; custom roles start at 100+.
ALTER TABLE `roles` ADD `position` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE roles SET position = 0 WHERE id = 'role_system_admin';
--> statement-breakpoint
UPDATE roles SET position = 1 WHERE id = 'role_member';
--> statement-breakpoint
UPDATE roles SET position = 2 WHERE id = 'role_anonymous';
