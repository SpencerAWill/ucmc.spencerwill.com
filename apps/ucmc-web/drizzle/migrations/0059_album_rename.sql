-- Rename the Trip Gallery to the Album. Data-only rename: the feature's
-- shape is unchanged, so this is table/index/permission/flag naming plus
-- a rewrite of already-written audit rows.
--
-- NOT renamed: the R2 object-key prefix (`gallery/<id>/<hash>.webp`).
-- Object keys aren't user-visible, and re-keying would mean a
-- copy-then-delete pass over every deployed bucket where a partial run
-- strands photos. See `ALBUM_R2_PREFIX` in
-- `src/features/album/lib/image-url.ts`.
ALTER TABLE `gallery_photos` RENAME TO `album_photos`;
--> statement-breakpoint
-- SQLite carries indexes along with a renamed table but keeps their
-- original names, so they have to be recreated to match.
DROP INDEX `gallery_photos_public_id_unique`;
--> statement-breakpoint
DROP INDEX `gallery_photos_tag_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `album_photos_public_id_unique` ON `album_photos` (`public_id`);
--> statement-breakpoint
CREATE INDEX `album_photos_tag_idx` ON `album_photos` (`tag`);
--> statement-breakpoint
-- Permissions are renamed by adding the new rows, copying every grant
-- across, then deleting the old ones — rather than UPDATEing
-- `permissions.id` in place, which `role_permissions.permission_id`
-- declares as `ON UPDATE no action`. Copying from the existing grants
-- (instead of re-seeding the 0056 defaults) preserves any role an
-- officer delegated the permission to at runtime.
INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_public_album_view',
   'public_album:view',
   'See the Album in the sidebar and browse the photo archive'),
  ('perm_public_album_manage',
   'public_album:manage',
   'Upload, edit, and delete Album photos');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT role_id, 'perm_public_album_view'
    FROM role_permissions
   WHERE permission_id = 'perm_public_gallery_view';
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT role_id, 'perm_public_album_manage'
    FROM role_permissions
   WHERE permission_id = 'perm_public_gallery_manage';
--> statement-breakpoint
-- Explicit, so this doesn't depend on whether FK cascade is enforced in
-- the connection running the migration.
DELETE FROM role_permissions
 WHERE permission_id IN ('perm_public_gallery_view', 'perm_public_gallery_manage');
--> statement-breakpoint
DELETE FROM permissions
 WHERE id IN ('perm_public_gallery_view', 'perm_public_gallery_manage');
--> statement-breakpoint
-- Rewrite already-written audit rows. `audit_log.action` is a plain TEXT
-- column (the Drizzle enum is a TS-level narrowing with no SQL CHECK),
-- so leaving these would render as unknown actions in the viewer rather
-- than failing anywhere — silent history loss. The action set is closed
-- and small, so an explicit REPLACE per value is clearer than a LIKE.
UPDATE audit_log SET action = 'album_photo.created' WHERE action = 'gallery_photo.created';
--> statement-breakpoint
UPDATE audit_log SET action = 'album_photo.updated' WHERE action = 'gallery_photo.updated';
--> statement-breakpoint
UPDATE audit_log SET action = 'album_photo.deleted' WHERE action = 'gallery_photo.deleted';
--> statement-breakpoint
-- The page kill switch. Only present if someone had toggled it; reads
-- fall back to the registry default (ON) when the row is absent, so an
-- untouched flag needs nothing here.
UPDATE OR REPLACE site_settings SET key = 'pages.album' WHERE key = 'pages.gallery';
