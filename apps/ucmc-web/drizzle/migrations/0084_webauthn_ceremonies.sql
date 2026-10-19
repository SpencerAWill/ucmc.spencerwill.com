-- WebAuthn ceremony challenges move from KV to D1 (#314).
--
-- Hand-written, like every migration since 0060: `db:generate` cannot
-- run against the stale meta snapshots (see CLAUDE.md).
--
-- ## Why
--
-- A ceremony's challenge must be usable once. In KV, the finish step
-- read it with `get` and then removed it with a separate `delete`. Two
-- concurrent finishes could both read it before either deleted it, and
-- KV is eventually consistent across locations, so a delete in one place
-- does not stop a cached read in another. The code claimed the challenge
-- "can never be replayed"; KV could not hold it to that.
--
-- Here, finish consumes a row with `DELETE … WHERE id = ? RETURNING`: one
-- statement, so exactly one caller gets the row back. Magic links already
-- work this way (`UPDATE … WHERE consumed_at IS NULL RETURNING`).
--
-- ## Lifetime
--
-- Rows live five minutes (the ceremony cookie's `maxAge`). Finish rejects
-- an expired row and deletes it as it reads, so a stale row is inert. The
-- daily retention tick deletes the rest. Passkey autofill starts a
-- ceremony on every `/sign-in` load, so the table holds about a day of
-- sign-in page views at most.
--
-- In-flight ceremonies started against KV before this deploy fail once
-- at finish with the normal "try again" result; nothing migrates them.
CREATE TABLE IF NOT EXISTS webauthn_ceremonies (
  -- `NOT NULL` is not redundant: SQLite permits NULL in a non-INTEGER
  -- PRIMARY KEY. `schema-drift.test.ts` enforces it.
  id         text    PRIMARY KEY NOT NULL,
  challenge  text    NOT NULL,
  -- `register` | `authenticate` (`webauthnCeremonyType` in schema.ts).
  type       text    NOT NULL,
  -- Register ceremonies only: finish checks it against the caller's
  -- session, so a passkey can't be registered onto someone else's
  -- account mid-flight. Deliberately not a foreign key: the session
  -- check is what makes it safe, a row lives five minutes, and a
  -- cascade would add a 41st edge to `users` for a row that is inert
  -- once its user is gone.
  user_id    text,
  created_at integer NOT NULL,
  expires_at integer NOT NULL
);
--> statement-breakpoint
-- The retention sweep deletes by expiry.
CREATE INDEX IF NOT EXISTS webauthn_ceremonies_expires_at_idx ON webauthn_ceremonies (expires_at);
