-- Operational log of outbound email, one row per send (issue #268).
--
-- Hand-written, like every migration since 0060: `db:generate` cannot
-- run against the stale meta snapshots (see CLAUDE.md).
--
-- Resend publishes NO usage history — `GET /emails` lists messages and
-- the `x-resend-*-quota` headers are point-in-time only — so any
-- month-over-month email figure has to be ours or it does not exist.
-- `sendEmail()` is the single choke point every send already passes
-- through, which also means the dev Mailpit tier is counted with no
-- special casing.
--
-- ## This table deliberately carries NO recipient
--
-- No `user_id`, no `to`, no subject, no body. It records that a send of
-- a given KIND happened at a given moment and whether it worked — a
-- counter with dimensions, not correspondence.
--
-- That is the whole reason it can exist this cheaply. Add a recipient
-- column and this stops being operational telemetry and becomes
-- per-member behavioural data: it would need a line in the `/privacy`
-- retention promises, a branch in `exportMyDataAction`, an
-- `ON DELETE CASCADE` to `users`, and a row in the compliance matrix.
-- It would also answer "who did we email and when", which is a question
-- about a person that nothing in this feature needs to ask.
--
-- **If you are here to add `user_id`, that is a compliance change, not
-- a schema tweak.** Take it through the compliance wiki first.
--
-- `kind` is an email-kind key, not a notification category: it spans
-- both the notification registry (`gear.loan_due_soon`) and auth mail
-- (`auth.magic_link`), which has no category because a magic link is
-- not something a member can switch off. See
-- `src/server/email/email-kinds.ts`.
--
-- Rows are swept on the existing retention tick — unlike
-- `cost_snapshots`, which is kept forever. The daily rollup into that
-- table is what survives; this log is the raw material for it and for
-- answering "what is driving volume this week".
CREATE TABLE IF NOT EXISTS email_sends (
  -- `NOT NULL` is not redundant: SQLite permits NULL in a non-INTEGER
  -- PRIMARY KEY, a legacy quirk it keeps for compatibility. Every other
  -- table here spells it out and `schema-drift.test.ts` enforces it.
  id      text    PRIMARY KEY NOT NULL,
  kind    text    NOT NULL,
  sent_at integer NOT NULL,
  -- 1 = the provider accepted it, 0 = the send threw. A failed send is
  -- still a send attempt and still tells us about volume; excluding it
  -- would make the log disagree with the provider's own count.
  ok      integer NOT NULL
);
--> statement-breakpoint
-- The rollup groups by (kind, day) over a date range, and the retention
-- sweep deletes by age. Both are served by sent_at leading.
CREATE INDEX IF NOT EXISTS email_sends_sent_at_idx ON email_sends (sent_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS email_sends_kind_sent_at_idx ON email_sends (kind, sent_at);
