-- Seed the three member-conduct permissions and their default grants.
--
-- ## The permissions
--
-- conduct:report  File a conduct report about another member. Grants no
--                 read access: a reporter never sees what they filed
--                 after submitting, or anyone else's report.
-- conduct:view    Read conduct records and reports. Bylaws §9.1 needs the
--                 whole Executive Committee to vote on a termination, so
--                 every voter has to be able to read the record.
-- conduct:manage  Create, triage and lift conduct records.
--
-- ## Seeded grants
--
-- role_member     conduct:report
-- role_president  conduct:view, conduct:manage
-- role_treasurer  conduct:view
-- role_advisor    conduct:view
--
-- Those are the only Executive Committee roles seeded; the board grants
-- conduct:view to any other exec role at /access. system_admin needs no
-- row: it auto-grants every permission via the bypass in
-- `principal.server.ts`.
--
-- None is anonymous_grantable: every signed-in viewer inherits the
-- anonymous role's grants, and conduct data is the last thing to hand out.
INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_conduct_report',
   'conduct:report',
   'File a conduct report about another member. Grants no read access.'),
  ('perm_conduct_view',
   'conduct:view',
   'Read conduct records and reports'),
  ('perm_conduct_manage',
   'conduct:manage',
   'Create, triage and lift conduct records');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_member', 'perm_conduct_report'),
  ('role_president', 'perm_conduct_view'),
  ('role_treasurer', 'perm_conduct_view'),
  ('role_advisor', 'perm_conduct_view'),
  ('role_president', 'perm_conduct_manage');
