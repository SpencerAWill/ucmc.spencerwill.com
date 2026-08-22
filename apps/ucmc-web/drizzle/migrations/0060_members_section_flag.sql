-- `pages.members` used to gate the approved-directory page. It's now the
-- SECTION switch for the whole /members area, and the directory page has
-- its own `pages.members_approved`.
--
-- Carry any stored value over to the page it actually described: an admin
-- who switched "Members" off meant "hide the directory", not "take down
-- the officer queues too". After this, the section defaults to on (no
-- row → registry default) and the directory keeps the off state.
--
-- OR REPLACE rather than plain UPDATE: if `pages.members_approved` had
-- somehow been written already, the PK collision would abort the
-- migration instead of the newer intent winning.
UPDATE OR REPLACE site_settings
   SET key = 'pages.members_approved'
 WHERE key = 'pages.members';
--> statement-breakpoint
-- Audit rows reference the setting key in `target_id`, so the history
-- shown on the /settings row follows the page it belongs to.
UPDATE audit_log
   SET target_id = 'pages.members_approved'
 WHERE action = 'settings_updated'
   AND target_id = 'pages.members';
