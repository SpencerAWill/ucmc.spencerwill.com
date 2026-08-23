-- `pages.announcements` was never a page flag. Besides hiding
-- /announcements it also hides the header bell and makes the server write
-- actions refuse, so it can't share the uniform "hide from nav and 404"
-- meaning every other `pages.*` switch has. It moves to the new `features`
-- category, which is for behaviour rather than reachability.
--
-- The two feedback submission switches move into `features` too, but by
-- category only — their keys are unchanged, so there's nothing to migrate
-- for them.
UPDATE OR REPLACE site_settings
   SET key = 'features.announcements'
 WHERE key = 'pages.announcements';
--> statement-breakpoint
-- Keep the setting's audit history attached to it after the rename.
UPDATE audit_log
   SET target_id = 'features.announcements'
 WHERE action = 'settings_updated'
   AND target_id = 'pages.announcements';
