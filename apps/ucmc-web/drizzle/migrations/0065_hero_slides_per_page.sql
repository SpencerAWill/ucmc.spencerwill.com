-- Generalize the home-page hero into a per-page hero.
--
-- `landing_hero_slides` was named for the only page that had one. Seven
-- more public pages now get their own, so the table becomes `hero_slides`
-- with a `page` discriminator and the home page becomes just another
-- value in it — one table, one editor, one component, per the decision
-- recorded in CLAUDE.md.
--
-- NOT renamed: the R2 object-key prefix (`landing/hero/<hash>.<ext>`).
-- Same reasoning as migration 0059 and the Album's `gallery/` prefix —
-- object keys aren't user-visible, and re-keying means a
-- copy-then-delete pass over every deployed bucket where a partial run
-- strands images. See `landingImageKey` in
-- `src/features/landing/server/landing-image.server.ts`.
ALTER TABLE `landing_hero_slides` RENAME TO `hero_slides`;
--> statement-breakpoint
-- `NOT NULL DEFAULT 'home'` is what carries the existing rows over:
-- every slide that exists today belongs to the home page.
ALTER TABLE `hero_slides` ADD `page` text DEFAULT 'home' NOT NULL;
--> statement-breakpoint
-- SQLite carries indexes along with a renamed table but keeps their
-- original names, so the old one is dropped rather than renamed. The
-- replacement leads with `page` because every read is scoped to one page
-- and then ordered — a bare `sort_order` index can't serve that.
DROP INDEX `landing_hero_slides_sort_idx`;
--> statement-breakpoint
CREATE INDEX `hero_slides_page_sort_idx` ON `hero_slides` (`page`,`sort_order`);
--> statement-breakpoint
-- The hero's overlay copy moves under a per-page namespace. `UPDATE OR
-- REPLACE` because the target key cannot already exist, but an
-- interrupted re-run shouldn't fail on a unique-key collision.
UPDATE OR REPLACE landing_settings SET key = 'hero.home.heading' WHERE key = 'hero.heading';
--> statement-breakpoint
UPDATE OR REPLACE landing_settings SET key = 'hero.home.tagline' WHERE key = 'hero.tagline';
--> statement-breakpoint
-- Rewrite already-written audit rows. `audit_log.action` and
-- `target_type` are plain TEXT (the Drizzle enums are TS-level
-- narrowings with no SQL CHECK), so stale values render as unknown
-- actions in the viewer rather than failing anywhere — silent history
-- loss. `landing.hero_slide_edited` also becomes actively wrong once an
-- /album slide writes one, which is why this is a rename and not a
-- carry-forward.
UPDATE audit_log SET action = 'hero_slide.edited' WHERE action = 'landing.hero_slide_edited';
--> statement-breakpoint
UPDATE audit_log SET target_type = 'hero_slide' WHERE target_type = 'landing_hero_slide';
--> statement-breakpoint
-- The per-setting history panel keys on the setting name, so a bare
-- `landing_settings` rename would strand the history of a heading that
-- has in fact been edited.
UPDATE audit_log SET target_id = 'hero.home.heading'
 WHERE target_type = 'landing_setting' AND target_id = 'hero.heading';
--> statement-breakpoint
UPDATE audit_log SET target_id = 'hero.home.tagline'
 WHERE target_type = 'landing_setting' AND target_id = 'hero.tagline';
