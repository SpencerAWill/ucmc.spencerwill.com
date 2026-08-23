-- `pages.gear` and `pages.feedback` each named an index page while reading
-- like a section, the same conflation `pages.members` had (migration 0060).
-- Both are now section switches for their whole area, and the pages they
-- used to gate have their own keys.
--
-- As in 0060, the stored value moves to the page it actually described: an
-- admin who switched "Gear" off meant "hide the inventory list", not "take
-- down the loans desk too". The new section nodes have no rows, so they
-- fall back to the registry default (on).
--
-- `/my` also gains a section (`pages.my`), but that key is new — nothing to
-- migrate for it.
UPDATE OR REPLACE site_settings
   SET key = 'pages.gear_inventory'
 WHERE key = 'pages.gear';
--> statement-breakpoint
UPDATE OR REPLACE site_settings
   SET key = 'pages.feedback_website'
 WHERE key = 'pages.feedback';
--> statement-breakpoint
-- Keep each setting's audit history attached to the page it belongs to.
UPDATE audit_log
   SET target_id = 'pages.gear_inventory'
 WHERE action = 'settings_updated'
   AND target_id = 'pages.gear';
--> statement-breakpoint
UPDATE audit_log
   SET target_id = 'pages.feedback_website'
 WHERE action = 'settings_updated'
   AND target_id = 'pages.feedback';
