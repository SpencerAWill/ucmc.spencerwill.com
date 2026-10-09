-- Member profile identity: trail name, pronouns, status line, prompts
-- and self-rated disciplines (issue #257, phase 1).
--
-- Hand-written, like every migration since 0060: `db:generate` cannot
-- run against the stale meta snapshots (see CLAUDE.md).
--
-- Purely additive: three nullable columns on `profiles` and two new
-- tables. Nothing is renamed, so none of the rename hazards apply — no
-- `audit_log` rewrite, no `LEGACY_SETTING_KEYS` read-through, no
-- permission alias shim. No new permission either: every field here is
-- public to approved members, which `members:view_private` already
-- draws the line below.
--
-- WHY COLUMNS FOR THE THREE SCALARS
-- =================================
-- `trail_name`, `pronouns` and `status_line` are one value per member,
-- always rendered together in the profile header, and always written by
-- the same form submit as `preferred_name`. A table would buy sparsity
-- for three short strings and cost a join on the hottest read in the
-- feature. The sparse-table trade (0072) pays off when the KEY SET
-- grows without a migration; these three are a fixed set.
--
-- All three are nullable with no default, because `ALTER TABLE ADD
-- COLUMN` on D1 cannot add a NOT NULL column without one, and a default
-- would invent a trail name for all ~200 existing members. NULL means
-- "not set" and the UI omits the line; it never means "".
--
-- WHY `profile_prompts` IS A TABLE
-- ================================
-- The opposite case: the prompt CATALOG lives in a code registry
-- (`src/server/member-profile/profile-prompt-registry.ts`), so adding
-- "Favorite knot" is an entry there, not a migration — the same trade
-- `site_settings` and `user_notification_preferences` already make.
-- Rows are sparse: a member who answers nothing has no rows.
--
-- `position` orders the answers as the member arranged them rather
-- than by prompt key, so reordering is a write here and not a second
-- concept. It is NOT unique per user: a swap would otherwise need an
-- interim write to dodge the constraint, and nothing reads position
-- except an ORDER BY that a duplicate merely makes arbitrary.
--
-- The answer cap (3) is enforced in zod, not here. A CHECK cannot count
-- sibling rows, and a trigger would put the limit somewhere no one
-- reading the schema would look for it.
--
-- WHY `profile_disciplines` IS SEPARATE FROM CERTIFICATIONS
-- =========================================================
-- These are SELF-RATED ("I'm comfortable in a cave"), and the UI labels
-- them as such. They authorize nothing. The certificates that will gate
-- lead and trad gear checkout are a different table with a granting
-- officer and an audit trail, and are deliberately NOT modelled here —
-- see issue #257 phase 2. Keeping them apart is what stops a member
-- self-rating their way into the trad rack.
--
-- Both the discipline list and the level scale live in the same code
-- registry as the prompts, for the same reason.

ALTER TABLE profiles ADD COLUMN trail_name text;

--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN pronouns text;

--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN status_line text;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS profile_prompts (
  user_id    text    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_key text    NOT NULL,
  answer     text    NOT NULL,
  position   integer NOT NULL,
  updated_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (user_id, prompt_key)
);

--> statement-breakpoint
-- The only read is "this member's answers, in their order". The primary
-- key already leads with `user_id`, so this index exists purely to let
-- that read come back sorted without a filesort.
CREATE INDEX IF NOT EXISTS profile_prompts_user_position_idx
  ON profile_prompts (user_id, position);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS profile_disciplines (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discipline text NOT NULL,
  level      text NOT NULL,
  updated_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (user_id, discipline)
);

--> statement-breakpoint
-- Answers "who has rated themselves experienced at caving", which is
-- what the directory's experience filter will ask. Leads with
-- `discipline` for the same reason 0072's index leads with `category`:
-- the primary key already covers the per-member read.
CREATE INDEX IF NOT EXISTS profile_disciplines_discipline_level_idx
  ON profile_disciplines (discipline, level);
