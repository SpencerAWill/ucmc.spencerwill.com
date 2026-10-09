import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

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

/**
 * Detect a SQLite FOREIGN KEY constraint failure walking the same
 * cause chain D1 wraps around the leaf error. Used by RESTRICT-on-delete
 * code paths (e.g. deleting a gear type while gear rows still reference
 * it) to convert the FK error into a typed user-facing result.
 */
export function isForeignKeyViolation(err: unknown): boolean {
  let cur: unknown = err;
  while (cur instanceof Error) {
    if (cur.message.includes("FOREIGN KEY constraint failed")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * A `LIKE '%needle%'` condition with the wildcards in `query` escaped,
 * so a search for `50%` matches that literal string instead of every
 * row.
 *
 * The `ESCAPE` clause is the load-bearing part. SQLite only treats a
 * character as an escape when the pattern carries an explicit `ESCAPE`,
 * and Drizzle's `like()` never emits one — so escaping the needle
 * *without* this template is worse than not escaping at all: `50%`
 * becomes the pattern `%50\%%`, which matches a literal backslash and
 * therefore nothing. Escaping and `ESCAPE` have to travel together,
 * which is why this is one helper rather than a bare needle-builder.
 *
 * Lives here beside the other dialect-level helpers because three
 * features search text columns and `import/no-restricted-paths` won't
 * let any of them import the others.
 */
export function likeContains(column: AnySQLiteColumn, query: string): SQL {
  const needle = `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  return sql`${column} LIKE ${needle} ESCAPE '\\'`;
}

/**
 * D1 binds at most **100 parameters per statement**. Measured against the
 * local Miniflare D1 by binary search over `inArray` list length — 100 binds,
 * 101 fails with `D1_ERROR: too many SQL variables`. `__tests__/d1-bound-params.test.ts`
 * pins the ceiling so a platform change surfaces as a failing test rather
 * than a 500 on a page nobody was looking at.
 *
 * This is a D1 limit, not a drizzle one: drizzle emits a correct statement
 * and D1 refuses to bind it.
 */
export const D1_MAX_BOUND_PARAMS = 100;

/**
 * Run a `WHERE col IN (…)` read whose id list may exceed what D1 will bind,
 * by splitting it into statements D1 accepts and concatenating the rows.
 *
 * Use this wherever the list comes from "everything matching X" rather than
 * from a UI page already bounded well under 100. A cap on the caller is not
 * a substitute: it couples a product decision to a storage limit, and it
 * cannot help the unbounded cases at all.
 *
 * `reservedParams` is the number of parameters the same statement binds for
 * anything other than the id list — a date range, a status, a tenant id.
 * Pass it rather than assuming the whole budget is available, so adding a
 * filter to a chunked query cannot silently push it back over the limit.
 *
 * **Ordering is per chunk, not global.** A single `ORDER BY` cannot span
 * separate statements, so callers must either sort the merged rows
 * themselves or depend only on ordering within one key — which holds
 * whenever every row for a given id lands in the same chunk, as it does when
 * chunking by that id.
 */
export async function selectInChunks<TId, TRow>(
  ids: readonly TId[],
  select: (chunk: readonly TId[]) => Promise<TRow[]>,
  options: { readonly reservedParams?: number } = {},
): Promise<TRow[]> {
  const reserved = options.reservedParams ?? 0;
  const perChunk = D1_MAX_BOUND_PARAMS - reserved;
  if (perChunk < 1) {
    throw new RangeError(
      `selectInChunks: reservedParams (${reserved}) leaves no room for ids within D1's ${D1_MAX_BOUND_PARAMS}-parameter limit.`,
    );
  }
  if (ids.length === 0) {
    return [];
  }
  if (ids.length <= perChunk) {
    return select(ids);
  }
  const chunks = Array.from(
    { length: Math.ceil(ids.length / perChunk) },
    (_unused, index) => ids.slice(index * perChunk, (index + 1) * perChunk),
  );
  const rows = await Promise.all(chunks.map((chunk) => select(chunk)));
  return rows.flat();
}
