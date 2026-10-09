-- Open `/calendar` to the public (issue #187).
--
-- Hand-written, like every migration since 0060: `db:generate` cannot
-- run against the stale meta snapshots (see CLAUDE.md).
--
-- The page shipped behind `requireApproved`, matching the ticket's
-- "authenticated-member route". That left an incoherence: the club
-- calendar publishes an ANONYMOUS `.ics` feed of its public events —
-- built for prospective members — while the only surface linking to
-- that feed was itself member-only. The people who could see the
-- "share this with anyone" link were exactly the people who did not
-- need it.
--
-- Nothing server-side changes. `currentVisibilityScope()` already
-- resolves an anonymous viewer to the public tier and the filtering
-- happens in the SQL `WHERE`, so an anonymous visitor sees precisely
-- the events the anonymous feed already serves them. This migration
-- only supplies the permission the route guard needs.
--
-- **Events still default to `visibility = 'members'`.** Making the page
-- public does not make its contents public: an officer marks an event
-- public deliberately, one event at a time. A freshly-opened page shows
-- nothing until someone does, which is the safe direction for a default
-- to fail in.
INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_public_calendar_view',
   'public_calendar:view',
   'See the Calendar page in the sidebar and browse public club events');
--> statement-breakpoint
-- Granted to BOTH role_anonymous and role_member, matching every other
-- public page: taking the calendar private again by revoking the
-- anonymous grant must not also lock members out of it.
--
-- There is still no `events:view`. Being able to reach the *page* and
-- being able to see a given *event* are different questions — the
-- second is answered per row by `visibility`, server-side, which is why
-- one permission can safely cover anonymous visitors and members alike.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_anonymous', 'perm_public_calendar_view'),
  ('role_member', 'perm_public_calendar_view');
