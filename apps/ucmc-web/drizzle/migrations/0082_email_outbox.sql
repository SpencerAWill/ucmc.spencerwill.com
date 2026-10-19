-- The dev email outbox (issue #297, docs/adr/0001-dev-email-outbox.md).
--
-- Hand-written, like every migration since 0060: `db:generate` cannot
-- run against the stale meta snapshots (see CLAUDE.md).
--
-- A deployed dev Worker with `EMAIL_OUTBOX` set writes each message
-- here instead of sending it, and `/dev/outbox` lists them behind
-- Cloudflare Access. It exists so dev needs no Resend credentials of
-- its own and stops borrowing prod's.
--
-- ## This table holds working sign-in links and real recipients
--
-- Unlike `email_sends`, which deliberately carries no recipient, this
-- is correspondence: `to`, the subject and the full body, which for a
-- magic link IS a credential for up to 15 minutes. That is acceptable
-- only because:
--
--   - it is written on dev alone. infra refuses `emailOutbox` on the
--     prod stack, and the sender refuses `EMAIL_OUTBOX` without the
--     Access settings the page verifies against. On prod the table
--     exists (migrations are shared) and stays empty;
--   - rows live one day. `/dev/outbox` prunes on every read and the
--     daily retention tick sweeps it too, so a dev Worker nobody looks
--     at still forgets.
--
-- **If you are here to turn this on for prod, that is a compliance
-- change, not a config flag.** Every member's sign-in link would sit in
-- a table anyone with D1 read access could use.
CREATE TABLE IF NOT EXISTS email_outbox (
  -- `NOT NULL` is not redundant: SQLite permits NULL in a non-INTEGER
  -- PRIMARY KEY. `schema-drift.test.ts` enforces it.
  id         text    PRIMARY KEY NOT NULL,
  -- An `EmailKind`, the same key `email_sends.kind` holds.
  kind       text    NOT NULL,
  "to"       text    NOT NULL,
  subject    text    NOT NULL,
  "text"     text    NOT NULL,
  html       text,
  created_at integer NOT NULL
);
--> statement-breakpoint
-- The page lists newest first and the prune deletes by age; both lead
-- with created_at.
CREATE INDEX IF NOT EXISTS email_outbox_created_at_idx ON email_outbox (created_at);
