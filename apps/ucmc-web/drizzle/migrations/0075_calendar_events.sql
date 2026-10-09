-- The club calendar's data layer (issue #187).
--
-- Purely additive: three new tables and two new permissions. Nothing is
-- renamed, so none of the rename hazards apply — no `audit_log` rewrite,
-- no `LEGACY_SETTING_KEYS` read-through, no permission alias shim.
--
-- Hand-written, like every migration since 0060: `db:generate` cannot
-- run against the stale meta snapshots (see CLAUDE.md).
--
-- `pages.calendar` already exists in the registry (it gated the sidebar
-- placeholder) and `calendar.feed_enabled` is a new registry entry, so
-- neither needs a `site_settings` row here: rows are written on first
-- toggle and reads fail open to the schema default.

-- `events` is a SUPERTYPE, not a peer feature table. The calendar page
-- and both .ics feeds read only this; kind-specific columns belong in
-- satellite tables keyed on `event_id` (a future `trips` carrying
-- leader/difficulty/capacity/cost, and `volunteer_events` once it is
-- restructured onto the same shape). That keeps the calendar read a
-- single indexed range scan and keeps `import/no-restricted-paths`
-- satisfiable — the alternative has the calendar importing every
-- feature that owns dated rows.
--
-- `starts_at` anchors the FIRST occurrence only. Later occurrences are
-- derived in `CLUB_TIME_ZONE` by calendar arithmetic, never by adding
-- 7 x 24h to the epoch — a weekly 18:00 meeting has to stay at 18:00
-- local across the DST boundary.
--
-- `sequence` is RFC 5545's, not ours: clients compare it to decide
-- whether an incoming VEVENT supersedes the copy they hold, so every
-- update path bumps it or edits silently never appear. `public_id` is
-- the other half of that contract — the emitted UID derives from it and
-- must never change, or clients duplicate the event on every poll.
--
-- `canceled_at` rather than a DELETE for a series called off: a
-- cancelled event must be PUBLISHED as cancelled (STATUS:CANCELLED) for
-- subscribers' copies to disappear. A row that merely stops being
-- emitted is read by most clients as "no change".
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`location` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`all_day` integer DEFAULT false NOT NULL,
	`kind` text NOT NULL,
	`visibility` text DEFAULT 'members' NOT NULL,
	`rrule` text,
	`sequence` integer DEFAULT 0 NOT NULL,
	`canceled_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text,
	`updated_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_public_id_unique` ON `events` (`public_id`);
--> statement-breakpoint
-- The calendar's only read shape: "events visible to this viewer,
-- overlapping this window". Visibility leads because it is an IN
-- against a three-value column, so the index narrows to the viewer's
-- tiers before the range scan on `starts_at`.
CREATE INDEX `events_visibility_starts_at_idx` ON `events` (`visibility`,`starts_at`);
--> statement-breakpoint
CREATE INDEX `events_starts_at_idx` ON `events` (`starts_at`);
--> statement-breakpoint
-- iCalendar's EXDATE and RECURRENCE-ID overrides in one table.
--
-- `occurrence_start` is the occurrence's ORIGINAL start as the series
-- generates it, which is exactly what RECURRENCE-ID carries — so a
-- moved occurrence keeps pointing at the slot it came from. Changing a
-- series' `starts_at` therefore orphans its exceptions by design, and
-- the update action clears them rather than silently re-pointing rows
-- at slots the officer never looked at.
--
-- NULL on an override column means INHERIT FROM THE SERIES, not
-- "unset" — an officer who later fixes the series title sees it flow
-- through to occurrences they had only moved.
CREATE TABLE `event_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`occurrence_start` integer NOT NULL,
	`canceled` integer DEFAULT false NOT NULL,
	`title` text,
	`description` text,
	`location` text,
	`starts_at` integer,
	`ends_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- One exception per slot, and also the lookup index: every expansion
-- loads a series' exceptions by `event_id`.
CREATE UNIQUE INDEX `event_exceptions_event_occurrence_unique` ON `event_exceptions` (`event_id`,`occurrence_start`);
--> statement-breakpoint
-- Personal .ics subscription tokens.
--
-- Its own table rather than a column on `users`: rotation without
-- destroying the history of what was rotated and when; one labelled
-- token per device, so "revoke my old phone" is possible;
-- `last_fetched_at` to answer "is Google actually polling this?" when a
-- member reports a stale calendar; and revocation as a timestamp the
-- audit log can point at rather than an overwritten value.
--
-- `token` is a BEARER CREDENTIAL — it ends up in plaintext in Google's
-- and Apple's fetchers and in the member's calendar app config. It is a
-- uuidv7 minted for this alone, never the session cookie and never
-- `users.public_id`. Revocation is `revoked_at`, not a DELETE, so a
-- leaked token stays un-reissuable: keeping the row is what guarantees
-- the UNIQUE index can never hand the same string out twice.
CREATE TABLE `calendar_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`label` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_fetched_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_subscriptions_token_unique` ON `calendar_subscriptions` (`token`);
--> statement-breakpoint
CREATE INDEX `calendar_subscriptions_user_idx` ON `calendar_subscriptions` (`user_id`);
--> statement-breakpoint
-- Two permissions, deliberately not the usual :view / :manage pair.
--
-- There is no `events:view`. Reading the calendar is gated by
-- `pages.calendar` plus `requireApproved` — being an approved member IS
-- the qualification, the same way /trips decided it. A third permission
-- would have to be granted to role_member on day one and would then
-- never be revoked from anyone, which is a row that does no work.
--
-- `events:read_private` is the one that earns its keep: it is the only
-- thing standing between an exec meeting and every member's phone, and
-- modelling it as a permission keeps it delegable at /access and
-- emulation-aware on the client.
--
-- Both are seeded ungranted. `system_admin` picks them up through the
-- bypass in principal.server.ts, and officer roles are delegated them
-- at /access — the club decides which officers run the calendar, and
-- that is not a decision a migration should make.
INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_events_manage',
   'events:manage',
   'Create, edit and cancel club calendar events'),
  ('perm_events_read_private',
   'events:read_private',
   'See officer-only events on the club calendar and in personal calendar feeds');
