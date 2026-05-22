-- Seed the per-feature permissions for the Goosedown Gazette.
--   public_gazette:view   — required to see the Goosedown Gazette
--                           link in the sidebar and reach /gazette
--                           + /gazette/$publicId. The PDF bytes are
--                           themselves served from the R2 public
--                           CDN (content-hashed keys, hard to
--                           enumerate) so this permission gates the
--                           discovery surface, not direct URL fetches.
--   public_gazette:manage — required to upload new issues, edit
--                           metadata, replace PDFs, and delete
--                           issues. system_admin auto-grants every
--                           permission via the bypass in
--                           principal.server.ts, so no explicit
--                           role_permissions row is needed for it;
--                           officer roles can pick it up at runtime
--                           via /members/roles when delegated.
--
-- View defaults are granted to BOTH role_anonymous (matches the
-- existing public_policies / public_resources etc. precedent —
-- unauthenticated visitors browsing the club can see the archive)
-- and role_member (so members never lose access if an admin later
-- revokes the anonymous grant).

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_public_gazette_view',
   'public_gazette:view',
   'See Goosedown Gazette in the sidebar and read issue archive'),
  ('perm_public_gazette_manage',
   'public_gazette:manage',
   'Upload, edit, and delete Goosedown Gazette issues');
--> statement-breakpoint

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_anonymous', 'perm_public_gazette_view'),
  ('role_member', 'perm_public_gazette_view');
