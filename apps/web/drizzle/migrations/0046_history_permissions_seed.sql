-- Seed permissions for the /history page.
--   history:view   → see the History link in the sidebar; visit /history;
--                    read the page's narrative + past-officers + honorary
--                    members archive. Auto-granted to role_member so every
--                    approved member can read the archive.
--   history:manage → see an Edit affordance on /history; update the
--                    narrative markdown; CRUD past-officer entries and
--                    honorary-member entries. system_admin auto-grants
--                    every permission via the bypass in
--                    principal.server.ts, so no explicit row is needed
--                    for it. Officer roles (President, Secretary, etc.)
--                    can pick this up at runtime via /members/roles when
--                    delegated.

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_history_view',
   'history:view',
   'See the History page in the sidebar and read the past-officers archive'),
  ('perm_history_manage',
   'history:manage',
   'Edit the history narrative and CRUD past-officer + honorary-member entries');
--> statement-breakpoint

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_member', 'perm_history_view');
