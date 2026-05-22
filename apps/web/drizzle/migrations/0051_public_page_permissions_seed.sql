-- Seed the per-page view + manage permissions for the four newly-
-- dynamic public pages migrated to `markdown_pages`. Pattern:
--   public_<slug>:view   — required to GET the page content (route
--                          guard + sidebar gate).
--   public_<slug>:manage — required to update the markdown (action
--                          gate + edit affordance).
--
-- system_admin auto-grants every permission via the bypass in
-- principal.server.ts, so no explicit role_permissions row is needed
-- for the `*:manage` side. Officer roles pick those up at runtime via
-- /members/roles when delegated.
--
-- Default grants for the `*:view` side preserve current public-access
-- behaviour: every page was reachable by anonymous visitors before
-- the markdown migration, so `role_anonymous` keeps the view perm by
-- default, and `role_member` does too so members never lose access
-- if an admin later revokes the anonymous grant.

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_public_policies_view',
   'public_policies:view',
   'See and read /policies (club gear, whitewater, and climbing rules)'),
  ('perm_public_policies_manage',
   'public_policies:manage',
   'Edit the /policies markdown body'),
  ('perm_public_scholarships_view',
   'public_scholarships:view',
   'See and read /scholarships (Steve Must Memorial Scholarship details)'),
  ('perm_public_scholarships_manage',
   'public_scholarships:manage',
   'Edit the /scholarships markdown body'),
  ('perm_public_gear_cave_view',
   'public_gear_cave:view',
   'See and read /gear-cave (prospective-member overview of the gear library)'),
  ('perm_public_gear_cave_manage',
   'public_gear_cave:manage',
   'Edit the /gear-cave markdown body'),
  ('perm_public_resources_view',
   'public_resources:view',
   'See and read /resources (trip-planning PDFs, external orgs, outdoor links)'),
  ('perm_public_resources_manage',
   'public_resources:manage',
   'Edit the /resources markdown body');
--> statement-breakpoint

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  -- View grants: preserve current public access for all four pages.
  ('role_anonymous', 'perm_public_policies_view'),
  ('role_anonymous', 'perm_public_scholarships_view'),
  ('role_anonymous', 'perm_public_gear_cave_view'),
  ('role_anonymous', 'perm_public_resources_view'),
  ('role_member', 'perm_public_policies_view'),
  ('role_member', 'perm_public_scholarships_view'),
  ('role_member', 'perm_public_gear_cave_view'),
  ('role_member', 'perm_public_resources_view');
