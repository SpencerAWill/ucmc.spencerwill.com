-- Seed permissions for the announcements feature.
-- announcements:read   → see the bell icon and load /announcements
-- announcements:manage → create, edit, and delete announcements
-- system_admin auto-grants every permission via the bypass in
-- principal.server.ts, so no explicit role_permissions rows are needed
-- for it. role_member gets announcements:read by default so every
-- approved member sees the bell.

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_announcements_read',
   'announcements:read',
   'See announcements and the bell-icon unread badge'),
  ('perm_announcements_manage',
   'announcements:manage',
   'Create, edit, and delete announcements');
--> statement-breakpoint

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_member', 'perm_announcements_read');
