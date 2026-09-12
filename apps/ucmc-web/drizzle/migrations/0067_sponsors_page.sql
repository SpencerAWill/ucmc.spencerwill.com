-- The public /sponsors page (issue #185).
--
-- Purely additive: one new table, three new permissions, two markdown
-- seed rows. Nothing is renamed, so none of the rename hazards apply —
-- no `audit_log` rewrite, no `LEGACY_SETTING_KEYS` read-through, no
-- permission alias shim, and therefore no need to split this across two
-- releases the way 0063/0064 were.
--
-- `pages.sponsors` is a new registry entry rather than a row here:
-- `site_settings` rows are only written on first toggle and reads fail
-- open to the schema default, so the kill switch needs no seed.

-- A flat, curated list. No `since` / `until` and no active-vs-past
-- split: sponsorship here is a standing relationship with a few local
-- businesses, not a per-season contract, so a date-derived "past
-- supporters" band would mostly be an empty heading. `sort_order` is
-- the officer's drag order; `public_id` is minted now so a future
-- `/sponsors/$publicId` (or a past band) costs nothing later.
--
-- `member_perk` is the one non-public column — a discount code is a
-- membership benefit, so the read action strips it for anyone without
-- `public_sponsors:perks` rather than relying on the client to hide it.
CREATE TABLE `sponsors` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`website_url` text,
	`blurb` text NOT NULL,
	`member_perk` text,
	`logo_key` text,
	`logo_width_px` integer,
	`logo_height_px` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text,
	`updated_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sponsors_public_id_unique` ON `sponsors` (`public_id`);
--> statement-breakpoint
CREATE INDEX `sponsors_sort_idx` ON `sponsors` (`sort_order`);
--> statement-breakpoint
-- Three permissions, not the usual two.
--
-- `:view` and `:manage` are the standard public-page pair, covering
-- both markdown bands and the sponsor rows the way public_volunteer:*
-- covers /volunteer's narrative, programs and outings.
--
-- `:perks` is the extra one, and it exists because the page has a
-- member-only field on an otherwise-public surface. Modelling it as a
-- permission rather than an `is approved member` test keeps it
-- delegable at /access, keeps it emulation-aware on the client, and
-- lets the club take perks public later by granting it to
-- role_anonymous instead of editing a gate.
INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_public_sponsors_view',
   'public_sponsors:view',
   'See the Sponsors page in the sidebar and browse the club''s sponsors'),
  ('perm_public_sponsors_perks',
   'public_sponsors:perks',
   'See member-only sponsor perks (discounts, codes, and how to claim them) on the Sponsors page'),
  ('perm_public_sponsors_manage',
   'public_sponsors:manage',
   'Edit the Sponsors page copy and the sponsor list');
--> statement-breakpoint
-- View goes to BOTH role_anonymous and role_member, matching every other
-- public page: taking the page private by revoking the anonymous grant
-- must not also lock members out of it.
--
-- Perks go to role_member ONLY. That single asymmetry is the whole
-- point of the third permission — a signed-out visitor sees the sponsor
-- and the relationship, not the discount code.
--
-- Manage is seeded ungranted; `system_admin` picks it up through the
-- bypass in principal.server.ts and it is delegated at /access.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role_anonymous', 'perm_public_sponsors_view'),
  ('role_member', 'perm_public_sponsors_view'),
  ('role_member', 'perm_public_sponsors_perks');
--> statement-breakpoint
-- Seed copy so the page isn't blank on first deploy. Officers replace
-- both bands through the same EditMarkdownSheet the other public pages
-- use.
INSERT OR IGNORE INTO markdown_pages (slug, markdown) VALUES
  ('sponsors',
   'UCMC is a student-run club with student-sized dues. The businesses below close the gap — with gear at cost, discounts for members, prizes for our events, and drinks for the drive home. Several have backed this club for longer than most of its current members have been at UC.

If you shop with them, tell them you''re with the Mountaineering Club. That is most of how these relationships stay worth it on their end.'),
  ('sponsors_pitch',
   '## Sponsor UCMC

We are roughly a hundred UC students who climb, paddle, hike, and ski — a group that buys rope, boats, boots, and beta, and that talks constantly about where it got them.

Sponsors support the club with gear discounts for members, product for trip raffles and events, or direct support for the Steve Must Memorial Scholarship. In return your name and mark sit on this page, go out with our event announcements, and get said out loud at every meeting where your gear shows up.

We are happy to put something together that fits what you actually want out of it. Get in touch and we''ll send details.');
