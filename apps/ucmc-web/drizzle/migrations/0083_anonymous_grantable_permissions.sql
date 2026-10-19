-- Which permissions the `anonymous` pseudo-role may hold.
--
-- Hand-written, like every migration since 0060: `db:generate` cannot
-- run against the stale meta snapshots (see CLAUDE.md).
--
-- ## Why
--
-- Since #300 every signed-in viewer keeps the anonymous role's grants
-- (`effectivePermissions` unions them in), so a grant to `anonymous` is
-- also a grant every member *sees*. Nothing limited what `/access` could
-- hand that role, and a write or private-read grant there turns on UI the
-- server then refuses: edit buttons answering "Forbidden", a Waivers nav
-- entry for the whole site. Whether a permission may be public isn't
-- readable from its name either: `waivers:view`, `audit:view` and
-- `analytics:view` all end in `:view`. So it is declared per permission,
-- here, and by the migration that adds any future public page's view
-- permission.
--
-- Enforced by `setRolePermissionsAction` (rejects), the role sheet (only
-- lists grantable permissions for `anonymous`), and
-- `loadAnonymousPermissions` (filters, so a stray row is inert).
-- Deliberately no trigger.
--
-- ## The set
--
-- The nine `public_*:view` permissions `anonymous` held by seed, plus
-- `history:view`, which `/history` is already built to serve publicly.
-- Not `public_sponsors:perks` (member perks are not public by
-- definition), and not the feedback `*:submit` pair (those actions need
-- a session, so a public grant would do nothing).
--
-- Matched by name, not id: names are what code checks, and ids follow
-- no single convention (0059 re-keyed the album's; 0064 kept its
-- renamed permissions' ids on purpose).
ALTER TABLE permissions
  ADD COLUMN anonymous_grantable integer NOT NULL DEFAULT 0;

UPDATE permissions
SET anonymous_grantable = 1
WHERE name IN (
  'public_album:view',
  'public_calendar:view',
  'public_gazette:view',
  'public_gear_cave:view',
  'public_policies:view',
  'public_resources:view',
  'public_scholarships:view',
  'public_sponsors:view',
  'public_volunteer:view',
  'history:view'
);

-- Drop any grant `anonymous` holds outside that set. Every seed granted
-- it only the nine view permissions above, so this is expected to delete
-- nothing; it is here so a hand-made grant from `/access` cannot survive
-- the rule that now forbids it. The same change moves the loader's KV
-- cache to a new key, so a set cached before this deploy isn't served.
DELETE FROM role_permissions
WHERE role_id = 'role_anonymous'
  AND permission_id IN (
    SELECT id FROM permissions WHERE anonymous_grantable = 0
  );
