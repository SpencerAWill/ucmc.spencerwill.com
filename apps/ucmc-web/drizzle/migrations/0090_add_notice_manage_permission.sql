-- Seed the notice:manage permission for the site notice banner.
--
-- ## Why a separate permission
--
-- The notice is a short sticky banner ("ALL gear must be turned in before
-- spring break trips") that the officer running the thing it announces
-- should be able to post without a system admin. Its four settings live
-- in the `notice` category on /settings, and `settings:manage` is the
-- wrong grant for that person: it also holds every page kill switch, the
-- feedback submission switches and the contact details, so delegating it
-- to post a banner would hand over the whole site's configuration.
--
-- `notice:manage` is therefore declared per key in the settings registry
-- (`SettingMeta.permission`), and grants the four `notice.*` settings and
-- nothing else. /settings admits anyone holding either permission and
-- shows each viewer only the categories they can edit; the write and the
-- history read check the permission of the key they touch.
--
-- ## Seeded grants
--
-- None. system_admin needs no row — it auto-grants every permission via
-- the bypass in `principal.server.ts`. Which officers post notices is a
-- club decision made at /access, not something to guess at here.
--
-- Not anonymous_grantable: posting to every page is an officer action.
INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_notice_manage',
   'notice:manage',
   'Edit the site notice banner (text, audience, tone, on/off) on /settings. Grants no other setting.');
