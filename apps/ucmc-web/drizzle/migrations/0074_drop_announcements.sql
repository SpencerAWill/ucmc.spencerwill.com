-- Remove the announcements feature outright. It was built but never
-- launched: `features.announcements` has defaulted OFF since 0009 and was
-- never switched on, so the member-facing surface (bell, sidebar entry,
-- /announcements) has never rendered for anyone. Rather than carry a dead
-- table, two dead permissions and a dead kill switch indefinitely, the
-- whole thing goes; bringing it back is a revert of this commit plus a
-- fresh CREATE TABLE.
--
-- Hand-written, like every migration since 0060: `db:generate` cannot run
-- against the stale meta snapshots (see CLAUDE.md).
--
-- What goes, and why each is safe:
--
--   * **`announcements`** — the table itself. Rows are discarded, not
--     archived. Nothing ever published to it in prod (the flag gated
--     writes as well as reads), and anything dev holds is seed data.
--
--   * **`users.last_read_announcements_at`** — the per-member read
--     watermark behind the bell's unread count. Meaningless without the
--     table. A plain DROP COLUMN, as in 0069: the column carries no index,
--     no constraint and no foreign key, and D1's SQLite is well past 3.35.
--
--   * **`announcements:read` / `announcements:manage`** — the permission
--     rows seeded by 0010, plus the `role_member` grant of the read tier.
--     Deleting them stops /access listing permissions for a feature that
--     no longer exists. Idempotent DELETEs, safe to re-run by hand.
--
--   * **`features.announcements`** — the site-settings row, now orphaned
--     from the registry. Reads are registry-driven so a stale row is
--     invisible, but it would still show up in a raw table dump as a
--     switch nothing honours.
--
-- `audit_log` rows are deliberately left alone. Past `settings_updated`
-- entries for `features.announcements` and any `targetType` rows naming an
-- announcement are a historical record of what officers actually did; the
-- audit viewer renders `target_id` as opaque text, so an action against a
-- table that no longer exists reads fine. 0062 went out of its way to keep
-- that history attached across the `pages.` → `features.` rename — this is
-- the same reasoning, and dropping it now would undo that.
DROP TABLE IF EXISTS `announcements`;
--> statement-breakpoint

ALTER TABLE `users` DROP COLUMN `last_read_announcements_at`;
--> statement-breakpoint

DELETE FROM role_permissions
 WHERE permission_id IN ('perm_announcements_read', 'perm_announcements_manage');
--> statement-breakpoint

DELETE FROM permissions
 WHERE id IN ('perm_announcements_read', 'perm_announcements_manage');
--> statement-breakpoint

DELETE FROM site_settings WHERE key = 'features.announcements';
