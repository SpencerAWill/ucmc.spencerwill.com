-- Seed the public_album:view_original permission for full-size Album photos.
--
-- ## Why a separate permission
--
-- The Album page serves a 1600x1200 public crop to anyone. Since Album
-- originals are now kept, a member can also open or download the
-- full-size, uncropped photo, and that is a different grant from
-- `public_album:view` (browse the page) and `public_album:manage`
-- (upload and edit): it lets the holder take home the whole file.
--
-- ## Why it is not anonymous_grantable
--
-- Full resolution is members-only. "Member" here means an approved
-- member: `role_member` ("Approved member", 0001_rbac_seed.sql) is
-- granted when an officer approves a registration, so the audience is
-- the club, not the open web. Putting it on `anonymous` would make every
-- full-size photo scrapable by anybody (and, via the anonymous floor, by
-- every signed-in account including ones still awaiting approval), which
-- is exactly what the public crop exists to avoid. `anonymous_grantable` therefore stays 0 (its default),
-- so /access refuses the grant and `loadAnonymousPermissions` ignores it.
--
-- ## Seeded grants
--
-- role_member only. system_admin needs no row: it auto-grants every
-- permission via the bypass in `principal.server.ts`. Other roles can be
-- given it at /access.
INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_public_album_view_original',
   'public_album:view_original',
   'Open and download the full-size, uncropped version of Album photos');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_member', 'perm_public_album_view_original');
