-- Seed the minimal RBAC floor: two roles (system_admin, member) and three
-- fundamental permissions that let the sysadmin bootstrap everything else.
-- Additional roles (president, vice_president, exec, trip_leader, etc.)
-- and finer-grained permissions will be created at runtime through the
-- admin UI — this migration only installs what's required before that UI
-- exists.
--
-- Kept as a migration (not a one-off seed script) because these rows are
-- schema-level static data required in every environment. Migrations run
-- automatically on every `wrangler d1 migrations apply`, so prod gets
-- them without a separate operational step.
--
-- `INSERT OR IGNORE` keeps the migration idempotent on direct re-execution
-- (D1's migration tracking already guards against double-application; this
-- is belt-and-suspenders for humans running the SQL by hand).
--
-- Permission naming follows the `<group>:<action>` convention — the
-- prefix is the group. Grouping is NOT a schema concept; the admin UI
-- can render sections by splitting the name on the colon.

INSERT OR IGNORE INTO roles (id, name, description) VALUES
  ('role_system_admin', 'system_admin', 'System administrator with full platform control'),
  ('role_member',       'member',       'Approved member');
--> statement-breakpoint

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_roles_manage',
   'roles:manage',
   'Create, rename, or delete roles and edit their permission grants'),
  ('perm_roles_assign',
   'roles:assign',
   'Assign or revoke roles on users'),
  ('perm_registrations_approve',
   'registrations:approve',
   'Approve or reject pending member registrations');
--> statement-breakpoint

-- system_admin gets every seeded permission. The member role starts with
-- none; specific capabilities get granted later through the admin UI as
-- new roles and permissions are defined.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_system_admin', 'perm_roles_manage'),
  ('role_system_admin', 'perm_roles_assign'),
  ('role_system_admin', 'perm_registrations_approve');
