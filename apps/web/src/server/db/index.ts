import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { env } from "#/server/cloudflare-env";
import * as schema from "../../../drizzle/schema.ts";

/**
 * D1 driver semantics worth knowing when reading callers of this module.
 *
 * `drizzle-orm/d1`'s `db.batch([...])` collapses to one
 * `D1Database#batch` HTTP request — `Promise.all([q1, q2, ...])` would
 * issue N separate calls. The batched call also runs as a single
 * SQLite transaction, so writes are atomic and reads observe a single
 * point-in-time snapshot.
 *
 * Both properties are specific to the D1 driver and are NOT part of
 * drizzle's cross-dialect contract. If this codebase ever swaps D1 for
 * another backend (libSQL, Turso, raw SQLite, Postgres), the new
 * `drizzle-orm/<driver>`'s `batch` implementation must be re-verified
 * to preserve the one-request + atomic-tx contract before the existing
 * call sites can be considered correct on the new backend.
 */
// Lazy singleton so the D1 binding is only touched when a server-fn handler
// actually runs. Module-level evaluation stays pure — important because this
// file can end up in the client bundle (TanStack Start's RPC compiler
// doesn't strip transitive server-module imports), and the client-side stub
// for `cloudflare:workers` throws if accessed.
let _db: DrizzleD1Database<typeof schema> | null = null;

export function getDb(): DrizzleD1Database<typeof schema> {
  if (!_db) {
    _db = drizzle(env.DB, { schema });
  }
  return _db;
}

export { schema };

/**
 * D1 surfaces unique-constraint violations as plain `Error`s whose
 * message contains `"UNIQUE constraint failed: <table>.<column>"`
 * (or, for indexes, `<table>.<index_columns...>`). Pass an
 * `indexFragment` to narrow the match to a specific index — useful
 * when a table has multiple unique constraints and the caller only
 * wants to recover from one of them.
 *
 * Example:
 *   try { await db.insert(...); }
 *   catch (e) {
 *     if (isUniqueViolation(e, "user_emails.email")) return "email_taken";
 *     throw e;
 *   }
 *
 * The pre-check before an insert is a UX layer; this helper is the
 * actual safety boundary against races where two requests pass the
 * pre-check and both attempt to insert.
 */
export function isUniqueViolation(
  err: unknown,
  indexFragment?: string,
): boolean {
  // D1 wraps the underlying SQLITE_CONSTRAINT error in a series of
  // outer Errors (drizzle's "Failed query: ..." wrapper, then D1's
  // "D1_ERROR: ..." wrapper, then the raw "UNIQUE constraint failed"
  // message at the leaf). Walk the cause chain so we catch the match
  // wherever it lives.
  let cur: unknown = err;
  while (cur instanceof Error) {
    if (cur.message.includes("UNIQUE constraint failed")) {
      if (!indexFragment || cur.message.includes(indexFragment)) return true;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
