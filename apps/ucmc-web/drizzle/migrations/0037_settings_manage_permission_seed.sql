-- Seed the settings:manage permission for the /settings admin page.
-- settings:manage → view and edit every site-wide setting in the registry
-- (contact info, feature flags, freeform config blobs). system_admin auto-
-- grants every permission via the bypass in principal.server.ts, so no
-- explicit role_permissions row is needed for it. No officer role gets
-- this by default — site-wide platform config sits one tier above the
-- usual officer concerns (gear, members, etc.). Add grants to specific
-- roles at runtime via /members/roles when an officer needs the desk.

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_settings_manage',
   'settings:manage',
   'View and edit site-wide settings and feature flags at /settings');
