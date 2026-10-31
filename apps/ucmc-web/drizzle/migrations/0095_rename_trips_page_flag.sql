-- The Google Form stopgap moves from /trips to the public /trip-sign-up, so
-- its kill switch is renamed to match and `pages.trips` is left free for the
-- real trips feature. Same three statements as 0085: rename the row, drop a
-- leftover old row, and carry the setting's audit history across.
-- `OR IGNORE` because `key` is the primary key: if a `pages.trip_signup` row
-- somehow already exists, keep it rather than failing the migration. A
-- missing row is fine either way; settings reads fail open to the default.
UPDATE OR IGNORE site_settings
   SET key = 'pages.trip_signup'
 WHERE key = 'pages.trips';
--> statement-breakpoint

-- No-op in the normal case. It only bites when `OR IGNORE` swallowed the
-- rename because a newer row already existed; that row is the one to keep.
DELETE FROM site_settings
 WHERE key = 'pages.trips';
--> statement-breakpoint

-- `settings_updated` audit rows key on the setting name, so without this the
-- per-setting history panel comes back empty for a switch that was toggled.
UPDATE audit_log
   SET target_id = 'pages.trip_signup'
 WHERE action = 'settings_updated'
   AND target_id = 'pages.trips';
