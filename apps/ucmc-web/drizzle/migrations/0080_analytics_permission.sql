-- Seed the analytics:view permission for the /analytics dashboard (issue #267).
--
-- Hand-written, like every migration since 0060: `db:generate` cannot
-- run against the stale meta snapshots (see CLAUDE.md).
--
-- ## One permission opens the route; the panels gate themselves
--
-- `analytics:view` is the route guard for `/analytics` and its five
-- children, and that is ALL it grants. It deliberately does not imply
-- the right to read any particular number: every panel additionally
-- checks the permission for the data it actually shows — gear panels
-- ask for `gear:*`, waiver coverage for the waiver-view pair, the
-- platform page for a system admin, membership for `members:manage`.
--
-- The alternative — one permission that unlocks every panel — would
-- mean granting a Trip Coordinator the waiver roster and the member
-- funnel in order to show them how many trips ran. Analytics is a
-- *presentation* of data the viewer can already see elsewhere, so the
-- gates belong on the data, not on the page. The consequence worth
-- stating: a role holding `analytics:view` and nothing else sees a real
-- page with no panels on it, which is correct, and the page says so
-- rather than rendering blank.
--
-- ## Why not reuse an existing permission
--
-- There is no permission today whose holders are exactly "people who
-- should see club-health reporting". `audit:view` is the closest and is
-- the wrong shape: it is scoped to the append-only officer-action log
-- for incident review (see 0021), not to membership trends.
--
-- ## Seeded grants
--
-- system_admin needs no row — it auto-grants every permission via the
-- bypass in `principal.server.ts`.
--
-- President and Treasurer get it because the panels answer questions
-- their constitutional duties already require them to ask: whether the
-- club is growing, what the gear inventory is doing, whether the RSO
-- event minimum is met, and what the site costs to run.
--
-- Advisor gets it for the same reason it holds `audit:view` — the CSA
-- reporter needs club-health context without a system_admin elevation.
--
-- role_member does NOT get it. This is officer reporting over other
-- members' participation; it is not member-facing, and `/my/profile`
-- is where a member sees their own season.
INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_analytics_view',
   'analytics:view',
   'Open the Analytics dashboard at /analytics. Each panel is additionally gated on the permission for the data it shows.');
--> statement-breakpoint

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_president', 'perm_analytics_view'),
  ('role_treasurer', 'perm_analytics_view'),
  ('role_advisor',   'perm_analytics_view');
