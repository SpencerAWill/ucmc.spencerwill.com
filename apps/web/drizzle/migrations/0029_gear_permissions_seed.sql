-- Seed permissions for the gear inventory feature.
-- gear:read   → browse /gear and view individual gear detail pages
-- gear:manage → create / edit / retire gear; manage types and tags;
--               run bulk imports
-- system_admin auto-grants every permission via the bypass in
-- principal.server.ts, so no explicit role_permissions rows are needed
-- for it. role_member gets gear:read by default so every approved
-- member can see what equipment the club owns; gear:manage is granted
-- to officer roles via the admin UI at runtime.

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_gear_read',
   'gear:read',
   'Browse club gear inventory'),
  ('perm_gear_manage',
   'gear:manage',
   'Create, edit, retire, and bulk-import gear; manage gear types and tags');
--> statement-breakpoint

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_member', 'perm_gear_read');
