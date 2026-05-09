-- Seed the new `members:ban` permission and grant it to system_admin.
-- Kept as a separate migration from `0028_ban_users.sql` (the schema
-- change) so the permission seed mirrors the established
-- `*_permissions_seed` convention (see 0023, 0021, 0015, 0010, 0004).
--
-- Distinct from `members:manage`: the `members:ban` permission is the
-- *only* gate on banMembersAction / unbanMembersAction. It is granted
-- here to system_admin only, matching every other lifecycle action's
-- current role gate. Splitting the permission name leaves room to grant
-- it to a future officer-tier role (e.g., president) without code
-- changes — the action layer already reads the permission, not a role.
-- system_admin auto-grants every permission via the bypass in
-- principal.server.ts, but we still seed an explicit row so the RBAC
-- editor surfaces the assignment.
--
-- Idempotent INSERT — safe to re-run by hand.

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_members_ban',
   'members:ban',
   'Ban / unban members. Distinct from members:manage; required to flip status to "banned" and to remove blocklist entries on unban.');
--> statement-breakpoint

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_system_admin', 'perm_members_ban');
