import { SQL as SQLExpression, getTableColumns, is, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type {
  AnySQLiteColumn,
  SQLiteInsertValue,
  SQLiteTable,
} from "drizzle-orm/sqlite-core";

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
 *
 * Prose columns with a trigram index search through `searchMatches()`
 * in `./search.ts` instead, which falls back to this helper for needles
 * too short to have a trigram. `column` accepts raw SQL for that
 * fallback, whose columns live on a virtual table Drizzle cannot model.
 */
export function likeContains(
  column: AnySQLiteColumn | SQL,
  query: string,
): SQL {
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

// ── statements whose size doesn't depend on the data ─────────────────
//
// The rule (#291): **no statement may bind a number of parameters that
// grows with the data.** D1 refuses anything past 100, and both shapes
// that grow — `inArray(col, list)` and `insert().values(rows)` — reach it
// through ordinary use rather than abuse. Three tools, in order of
// preference:
//
//   1. A subquery or join, when the list came out of the database in the
//      first place. Zero list parameters; the planner does the matching.
//   2. `inJsonArray` / `notInJsonArray`, when the list came from the
//      caller. One parameter, whatever the length.
//   3. `insertStatements` / `insertMany` for multi-row writes, which split
//      the rows across statements inside one atomic batch.
//
// `inArray` / `notInArray` from `drizzle-orm` are banned outside this
// module by ESLint (`no-restricted-imports`), so the old shape can't come
// back by habit.

/**
 * `column IN (…values)`, binding the whole list as **one** JSON parameter
 * and expanding it with SQLite's `json_each` — the pattern D1's own docs
 * give for exactly this ("Expand arrays for IN queries"). Verified against
 * D1 with 5000 values.
 *
 * Use it when the values come from the caller (selected rows, a filter in
 * the URL). When they came out of a previous query, write the subquery
 * instead: the database already knows the answer, and shipping it back as
 * a list is a round trip that only adds risk.
 *
 * An empty list matches nothing, as `IN ()` would if SQL allowed it.
 * Values are compared as JSON scalars: strings stay TEXT and integers stay
 * INTEGER, which is what every id column here stores. Don't pass booleans
 * or Temporal values — convert them to the stored form first.
 */
export function inJsonArray(
  column: AnySQLiteColumn | SQL,
  values: readonly (string | number)[],
): SQL {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;
}

/** `column NOT IN (…values)` — see `inJsonArray`. An empty list excludes
 *  nothing. */
export function notInJsonArray(
  column: AnySQLiteColumn | SQL,
  values: readonly (string | number)[],
): SQL {
  return sql`${column} NOT IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;
}

/**
 * `column IN (subquery)` — Drizzle's `inArray`, narrowed to the form that
 * binds no list. The type takes a query builder (any `SQLWrapper`), and a
 * plain array isn't one, so this can't be handed the shape #291 exists to
 * stop. It's how the rest of the app reaches `inArray` now that ESLint
 * bans importing it directly.
 */
export function inSubquery(
  column: AnySQLiteColumn | SQL,
  subquery: SQLWrapper,
): SQL {
  // What `inArray` itself emits for a subquery; written out because its
  // overloads won't accept a column-or-SQL union.
  return sql`${column} in ${subquery}`;
}

/** `column NOT IN (subquery)` — see `inSubquery`. */
export function notInSubquery(
  column: AnySQLiteColumn | SQL,
  subquery: SQLWrapper,
): SQL {
  return sql`${column} not in ${subquery}`;
}

/**
 * How many rows one multi-row INSERT into `table` can carry.
 *
 * A column is counted as bound unless it has a SQL-expression default
 * (`created_at` defaulting to `unixepoch() * 1000`) **and no row
 * supplies it** — Drizzle inlines such a default only when the value is
 * left out. Everything else is counted, including omitted columns with
 * no default (Drizzle actually writes a literal `null` for those), so
 * the figure can only overcount, which is the safe direction. Pass the
 * rows you're about to insert; without them every SQL-default column is
 * assumed omitted.
 *
 * An audit row binds 7, so 14 rows fit. A tag assignment binds 4 once
 * its `assignedAt` is supplied — the case that showed the rows have to
 * be consulted at all.
 *
 * `reservedParams` is anything else the same statement binds.
 */
export function rowsPerInsertStatement(
  table: SQLiteTable,
  reservedParams = 0,
  rows: readonly Record<string, unknown>[] = [],
): number {
  const supplied = new Set(
    rows.flatMap((row) =>
      Object.entries(row)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key),
    ),
  );
  const columns = Object.entries(getTableColumns(table)).filter(
    ([key, column]) => !is(column.default, SQLExpression) || supplied.has(key),
  ).length;
  const perStatement = Math.floor(
    (D1_MAX_BOUND_PARAMS - reservedParams) / columns,
  );
  if (perStatement < 1) {
    throw new RangeError(
      `rowsPerInsertStatement: one row of ${columns} columns plus ${reservedParams} reserved parameters exceeds D1's ${D1_MAX_BOUND_PARAMS}.`,
    );
  }
  return perStatement;
}

/** `rows` cut into runs of at most `size`. */
export function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_unused, i) =>
    rows.slice(i * size, (i + 1) * size),
  );
}

type BatchStatement = Parameters<
  DrizzleD1Database<typeof schema>["batch"]
>[0][number];

/**
 * The INSERT statements that write `rows` into `table` without any one of
 * them binding more than D1 accepts. Spread them into a `db.batch([...])`
 * alongside the rest of the mutation; on their own, use `insertMany`.
 *
 * Splitting inside a batch keeps the write atomic and costs one round
 * trip: D1 applies its per-query limits to each statement in a batch
 * individually, and runs the batch as one transaction.
 */
export function insertStatements<TTable extends SQLiteTable>(
  table: TTable,
  rows: readonly SQLiteInsertValue<TTable>[],
  options: {
    /** Skip rows that collide with an existing key, per statement —
     *  `INSERT … ON CONFLICT DO NOTHING`. */
    readonly onConflictDoNothing?: boolean;
  } = {},
): BatchStatement[] {
  const db = getDb();
  return chunkRows(rows, rowsPerInsertStatement(table, 0, rows)).map((part) => {
    const insert = db.insert(table).values(part);
    return options.onConflictDoNothing ? insert.onConflictDoNothing() : insert;
  });
}

/**
 * `db.batch` over a list that may be empty. Drizzle types the batch as a
 * non-empty tuple, and an empty one is a runtime error; every caller that
 * builds statements from data has to handle that, so it's handled here.
 */
export async function runBatch(
  statements: readonly BatchStatement[],
): Promise<void> {
  const first = statements.at(0);
  if (first === undefined) {
    return;
  }
  await getDb().batch([first, ...statements.slice(1)]);
}

/** Insert any number of rows atomically. See `insertStatements`. */
export async function insertMany<TTable extends SQLiteTable>(
  table: TTable,
  rows: readonly SQLiteInsertValue<TTable>[],
  options: { readonly onConflictDoNothing?: boolean } = {},
): Promise<void> {
  await runBatch(insertStatements(table, rows, options));
}
