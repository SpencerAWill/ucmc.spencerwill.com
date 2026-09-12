-- The public /volunteer page (issue #184).
--
-- Purely additive: two new tables, two new permissions, one seed row.
-- Nothing is renamed, so none of the rename hazards apply — no
-- `audit_log` rewrite, no `LEGACY_SETTING_KEYS` read-through, no
-- permission alias shim, and therefore no need to split this across two
-- releases the way 0063/0064 were.
--
-- `pages.volunteer` already exists as a registry entry (it gated the
-- "coming soon" sidebar placeholder), so the kill switch needs no row
-- here — `site_settings` rows are only written on first toggle and
-- reads fail open to the schema default.
CREATE TABLE `volunteer_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`icon` text NOT NULL,
	`title` text NOT NULL,
	`blurb` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `volunteer_opportunities_sort_idx` ON `volunteer_opportunities` (`sort_order`);
--> statement-breakpoint
-- No status column: "upcoming" vs "past" is derived from `starts_at`
-- against the start of today in America/New_York, so the two bands on
-- /volunteer can never disagree and nothing has to be flipped by a cron.
-- The single `starts_at` index serves both reads — ascending for
-- "Coming up", descending for the archive.
CREATE TABLE `volunteer_events` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`title` text NOT NULL,
	`partner_org` text,
	`location` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`description` text,
	`signup_url` text,
	`volunteers_count` integer,
	`service_hours` integer,
	`album_tag` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text,
	`updated_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `volunteer_events_public_id_unique` ON `volunteer_events` (`public_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_events_starts_at_idx` ON `volunteer_events` (`starts_at`);
--> statement-breakpoint
-- One permission pair covers the whole page — the narrative markdown,
-- the opportunity cards, and the events — exactly as history:view /
-- history:manage covers /history's narrative, officer archive and
-- honorary list. `system_admin` picks up the manage permission through
-- the bypass in principal.server.ts, so it gets no explicit grant and is
-- delegated at /access instead.
INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_public_volunteer_view',
   'public_volunteer:view',
   'See the Volunteer page in the sidebar and browse volunteer programs, upcoming outings, and the service record'),
  ('perm_public_volunteer_manage',
   'public_volunteer:manage',
   'Edit the Volunteer page narrative, programs, and outings');
--> statement-breakpoint
-- View is granted to BOTH role_anonymous and role_member, matching every
-- other public page: taking the page private by revoking the anonymous
-- grant must not also lock members out of it.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_anonymous', 'perm_public_volunteer_view'),
  ('role_member', 'perm_public_volunteer_view');
--> statement-breakpoint
-- Seed copy so the page isn't blank on first deploy. Officers replace
-- it through the same EditMarkdownSheet the other public pages use.
INSERT OR IGNORE INTO markdown_pages (slug, markdown) VALUES
  ('volunteer',
   'UCMC climbs, paddles, and hikes on ground that other people keep open. Trail crews cut the approach, local coalitions buy the crag, and park staff hold the rest together on budgets that never quite stretch. Showing up for that work is part of being a club rather than a group of people who happen to own ropes.

We volunteer as a club a few times each semester — trail days, crag cleanups, adopt-a-highway stretches, and gear drives for programs that put beginners outside. Everything is beginner-friendly and no experience is required. Bring work gloves and water; we handle the rest.

**Organizations:** if you have work that a group of fit, cheerful students could help with, we would like to hear from you. Use the button at the bottom of this page.');
