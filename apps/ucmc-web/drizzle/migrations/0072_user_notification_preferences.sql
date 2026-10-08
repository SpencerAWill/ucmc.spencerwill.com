-- Per-user notification preferences (issue #224).
--
-- Hand-written, like every migration since 0060: `db:generate` cannot
-- run against the stale meta snapshots (see CLAUDE.md).
--
-- WHY A TABLE AND NOT COLUMNS ON `users`
-- ======================================
-- This is the app's FIRST persisted per-user preference — the theme
-- toggle is client-side and the "privacy" controls are export/delete
-- buttons — so it sets the pattern, and the pattern it copies is
-- `site_settings`: the shape, the labels, the defaults and the
-- opt-out-ability all live in a zod registry in code
-- (`src/server/notifications/notification-registry.ts`), and the table
-- holds only values that differ from it.
--
-- A boolean column per category would make every new category a
-- migration. Sparse rows make it a registry entry, which is the same
-- trade CLAUDE.md already records for site settings.
--
-- WHY THE ROWS ARE SPARSE
-- =======================
-- A missing row means "the registry default", so a member who has never
-- opened the preferences tab has no rows at all. The daily gear-reminder
-- cron reads the opt-out set with a single
-- `WHERE category = ? AND channel = ? AND enabled = 0`, which is the
-- whole point of the `(category, channel, enabled)` index below — it
-- answers "who opted out" without a scan per recipient.
--
-- WHY `channel`, WHEN THERE IS ONLY EMAIL
-- =======================================
-- It is the one speculative column here, and it is in because the key is
-- a composite primary key: adding a channel later would mean rebuilding
-- that key, and SQLite has no ALTER COLUMN (see 0071 for how unpleasant
-- that gets on D1). One TEXT column now is cheaper than a table rebuild
-- the first time SMS or push is wanted.
--
-- WHY `source`
-- ============
-- Distinguishes a deliberate toggle on the preferences tab from a click
-- on an unsubscribe link in a courtesy email. These rows are NOT
-- audited — the audit log records officer actions against the club, and
-- a member toggling their own email preference would be noise in it —
-- so `source` plus `updated_at` is the record, and it answers the only
-- question anyone actually asks: "I never turned that off."
--
-- NOTE ON NON-SUPPRESSIBLE CATEGORIES
-- ===================================
-- Categories the registry marks `suppressible: false` (the overdue-gear
-- notice) never consult this table at all, so a stray row cannot
-- silence one. That is enforced in the repo, not here: a CHECK would
-- have to name the categories, and the whole point of the registry is
-- that the category list is not in the schema.

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id    text    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   text    NOT NULL,
  channel    text    NOT NULL,
  enabled    integer NOT NULL,
  source     text    NOT NULL,
  updated_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (user_id, category, channel)
);

--> statement-breakpoint
-- Serves the cron's bulk opt-out read. Deliberately leads with
-- `category` rather than `user_id`: the primary key already covers
-- lookups for one member, and the query that needs an index is the one
-- that asks for every member who turned one category off.
CREATE INDEX IF NOT EXISTS user_notification_preferences_category_idx
  ON user_notification_preferences (category, channel, enabled);
