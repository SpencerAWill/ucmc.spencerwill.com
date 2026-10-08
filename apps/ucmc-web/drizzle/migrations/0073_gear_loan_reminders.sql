-- Loan reminder ladder state on `gear_loans` (issue #224).
--
-- Hand-written, like every migration since 0060: `db:generate` cannot
-- run against the stale meta snapshots (see CLAUDE.md).
--
-- WHAT THE COLUMNS ARE FOR
-- ========================
-- `reminder_stage` is the dedupe. The daily job computes the rung a loan
-- has reached and sends only when that outranks the recorded stage, then
-- advances it. The ladder only climbs, which makes the job idempotent
-- (a second run the same day sends nothing) and outage-tolerant (a
-- missed day is picked up at the right rung tomorrow, not skipped
-- forever, which is what a purely date-triggered ladder would do).
--
-- `last_reminded_at` is NOT the dedupe — it is officer-facing. "When did
-- we last chase them" is a question the loan detail page and the overdue
-- list both want to answer, and deriving it from the stage is
-- impossible.
--
-- THE BACKFILL IS THE POINT OF THIS MIGRATION
-- ===========================================
-- Without it, the first run after deploy chases EVERY currently-overdue
-- loan at once — including rows that came in through the CSV backfill
-- and are years old. Dozens of members get mail about gear nobody has
-- asked them for in months, all in one morning, and the reminder system
-- is distrusted from its first day.
--
-- So every open loan is stamped with the rung it ALREADY qualifies for.
-- The first cron run then has nothing to say about them, and only
-- genuine future transitions produce mail. A loan already past the block
-- threshold lands on 'blocked', which is terminal, and stays quiet.
--
-- The day counts below are whole days between `due_at` and now, matching
-- `clubDayDifference`. The thresholds are the REGISTRY DEFAULTS for
-- `gear.overdueFlagDays` (7) and `gear.overdueBlockDays` (21), spelled
-- out as literals because a migration cannot read `site_settings` — the
-- values live there as JSON and may not have rows at all. If an operator
-- has tuned them, the backfill is off by the difference for exactly the
-- loans sitting between the two values, which at worst means one
-- member's first email is the flag rung instead of the block rung. That
-- is the right trade against hardcoding a query into the settings table.
--
-- Returned loans are left at 'none'. The job only reads open loans, and
-- a returned loan that is somehow reopened should start the ladder over.

ALTER TABLE gear_loans ADD COLUMN reminder_stage text NOT NULL DEFAULT 'none';

--> statement-breakpoint
ALTER TABLE gear_loans ADD COLUMN last_reminded_at integer;

--> statement-breakpoint
-- Open loans only, stamped with the rung already reached. Ordered
-- strictest-first so each row takes its highest qualifying rung.
UPDATE gear_loans
SET reminder_stage = CASE
  WHEN (unixepoch() * 1000 - due_at) / 86400000 >= 21 THEN 'blocked'
  WHEN (unixepoch() * 1000 - due_at) / 86400000 >= 7  THEN 'flagged'
  WHEN (unixepoch() * 1000 - due_at) / 86400000 >= 1  THEN 'overdue'
  WHEN due_at <= unixepoch() * 1000                   THEN 'due_soon'
  -- Not yet due. Deliberately NOT stamped 'due_soon' even when it falls
  -- inside the lead window: a loan due in two days SHOULD get its
  -- courtesy nudge tomorrow morning. Only the already-overdue backlog is
  -- being silenced here, not the normal ladder.
  ELSE 'none'
END
WHERE returned_at IS NULL;

--> statement-breakpoint
-- The job scans open loans every morning. `gear_loans_due_idx` already
-- covers `due_at`; this one lets the scan skip rows that have nothing
-- left to climb to, which is most of them once the cave is in a steady
-- state.
CREATE INDEX IF NOT EXISTS gear_loans_reminder_idx
  ON gear_loans (returned_at, reminder_stage);
