-- Defense-in-depth: reject empty `display_name` writes at the DB layer.
--
-- App-layer validation (zod `.trim().min(1)` in rbac-fns) is the primary
-- guard — these triggers exist so a future raw-SQL seed, a test fixture,
-- or a manual D1 console session can't sneak a "" row past the schema
-- and surface a blank card on the public "Meet the officers" section.
--
-- Triggers instead of a CHECK constraint because SQLite has no
-- `ALTER TABLE ADD CHECK`; the alternative is a full table rebuild,
-- which is more risk than the defense warrants given the FK references
-- from `user_roles` and `role_permissions`.

CREATE TRIGGER `roles_display_name_non_empty_insert`
BEFORE INSERT ON `roles`
WHEN length(NEW.display_name) = 0
BEGIN
  SELECT RAISE(ABORT, 'display_name must not be empty');
END;
--> statement-breakpoint
CREATE TRIGGER `roles_display_name_non_empty_update`
BEFORE UPDATE OF display_name ON `roles`
WHEN length(NEW.display_name) = 0
BEGIN
  SELECT RAISE(ABORT, 'display_name must not be empty');
END;
