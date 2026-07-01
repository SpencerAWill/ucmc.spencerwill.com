-- Seed the per-feature permissions for the Trip Gallery.
--   public_gallery:view   — required to see the Trip Gallery link
--                           in the sidebar and reach /gallery. The
--                           image bytes are themselves served from
--                           the R2 public CDN (content-hashed keys,
--                           hard to enumerate) so this permission
--                           gates the discovery surface, not direct
--                           image URL fetches.
--   public_gallery:manage — required to upload new photos, edit
--                           metadata, replace cropped images, and
--                           delete photos. system_admin auto-grants
--                           every permission via the bypass in
--                           principal.server.ts, so no explicit
--                           role_permissions row is needed for it.
--                           Officer roles can pick it up at runtime
--                           via /members/roles when delegated.
--
-- View defaults are granted to BOTH role_anonymous (matches the
-- existing public_gazette / public_policies precedent — unauthenticated
-- visitors browsing the club can browse the archive) and role_member
-- (so members never lose access if an admin later revokes the
-- anonymous grant).

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_public_gallery_view',
   'public_gallery:view',
   'See the Trip Gallery in the sidebar and browse the photo archive'),
  ('perm_public_gallery_manage',
   'public_gallery:manage',
   'Upload, edit, and delete Trip Gallery photos');
--> statement-breakpoint

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_anonymous', 'perm_public_gallery_view'),
  ('role_member', 'perm_public_gallery_view');
