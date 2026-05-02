-- Seed the three officer roles that need to exist in every environment
-- so officer-only permissions (e.g. `waivers:verify` from
-- 0015_waiver_permissions_seed.sql) can be granted by default rather
-- than requiring a manual admin-UI dance after every deploy.
--
-- Per the UCMC Constitution & Bylaws, the elected officer set is
-- larger than three (President, Vice President, Treasurer, Secretary,
-- Equipment Officer, Outings Officer) plus the Faculty Advisor. We
-- only seed the three roles that the website meaningfully gates on
-- today (Advisor for read-only Clery/CSA oversight; President and
-- Treasurer for the paper-waiver attestation queue). The rest can be
-- created at runtime through the admin UI when the website needs
-- them — no point seeding empty roles.
--
-- `INSERT OR IGNORE` keeps the migration idempotent on direct
-- re-execution.
--
-- Permission grants below: only President + Treasurer get
-- `waivers:verify`. system_admin already has every permission via the
-- bypass in principal.server.ts, so no explicit grant is needed for
-- it. The Advisor role is intentionally permission-light; CSA / Clery
-- oversight responsibilities are off-platform, and read access to
-- the member directory comes for free with the `member` role (which
-- approved users get on registration approval).

INSERT OR IGNORE INTO roles (id, name, description) VALUES
  ('role_advisor',
   'advisor',
   'Faculty advisor — read-only oversight; Clery/CSA reporter'),
  ('role_president',
   'president',
   'Elected club president'),
  ('role_treasurer',
   'treasurer',
   'Elected club treasurer — owns the canonical roster + paper waivers');
--> statement-breakpoint

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_president', 'perm_waivers_verify'),
  ('role_treasurer', 'perm_waivers_verify');
