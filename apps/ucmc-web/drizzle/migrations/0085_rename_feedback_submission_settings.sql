-- Each feedback surface names its own submission switch, so the two keys read
-- as what they gate and the site one cannot be mistaken for the club one.
-- Same three statements as 0064: rename the row, drop a leftover old row,
-- and carry the setting's audit history across.
-- `OR IGNORE` because `key` is the primary key: if a `site_feedback.submissions_enabled` row
-- somehow already exists, keep it rather than failing the migration. A
-- missing row is fine either way; settings reads fail open to the default.
UPDATE OR IGNORE site_settings
   SET key = 'site_feedback.submissions_enabled'
 WHERE key = 'feedback.site_enabled';
--> statement-breakpoint

-- No-op in the normal case. It only bites when `OR IGNORE` swallowed the
-- rename because a newer row already existed; that row is the one to keep.
DELETE FROM site_settings
 WHERE key = 'feedback.site_enabled';
--> statement-breakpoint

-- `settings_updated` audit rows key on the setting name, so without this the
-- per-setting history panel comes back empty for a switch that was toggled.
UPDATE audit_log
   SET target_id = 'site_feedback.submissions_enabled'
 WHERE action = 'settings_updated'
   AND target_id = 'feedback.site_enabled';
--> statement-breakpoint

-- `OR IGNORE` because `key` is the primary key: if a `club_feedback.submissions_enabled` row
-- somehow already exists, keep it rather than failing the migration. A
-- missing row is fine either way; settings reads fail open to the default.
UPDATE OR IGNORE site_settings
   SET key = 'club_feedback.submissions_enabled'
 WHERE key = 'feedback.club_enabled';
--> statement-breakpoint

-- No-op in the normal case. It only bites when `OR IGNORE` swallowed the
-- rename because a newer row already existed; that row is the one to keep.
DELETE FROM site_settings
 WHERE key = 'feedback.club_enabled';
--> statement-breakpoint

-- `settings_updated` audit rows key on the setting name, so without this the
-- per-setting history panel comes back empty for a switch that was toggled.
UPDATE audit_log
   SET target_id = 'club_feedback.submissions_enabled'
 WHERE action = 'settings_updated'
   AND target_id = 'feedback.club_enabled';
