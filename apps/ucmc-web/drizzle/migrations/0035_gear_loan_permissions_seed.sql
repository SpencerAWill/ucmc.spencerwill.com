-- Seed the gear-loans / checkout permission.
-- gear:loan → run checkout and check-in flows at the gear cave;
--             distinct from gear:manage so a "gear cave keeper" role
--             can be granted desk authority without full inventory
--             CRUD. system_admin auto-grants every permission via the
--             bypass in principal.server.ts, so no explicit
--             role_permissions row is needed for it. Officer roles
--             receive this grant at runtime via the admin UI — mirrors
--             how gear:manage was rolled out (see 0029).

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_gear_loan',
   'gear:loan',
   'Run gear-cave checkouts and check-ins');
