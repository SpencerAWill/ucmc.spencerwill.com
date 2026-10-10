import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { likeContains } from "#/server/db";

/**
 * A trigram FTS5 table and its key table, created by
 * `0081_search_fts.sql`, described for `searchMatches`. Drizzle cannot
 * model a virtual table, so this descriptor is the one place each
 * table's name and columns are written down on the TypeScript side;
 * `search-fts.test.ts` checks every descriptor against the migrated
 * database.
 *
 * `keyTable` maps the FTS rowid (its INTEGER PRIMARY KEY `id`) to the
 * base row's text ids, listed in `keys` — what a match is joined back
 * through. `columns` are the indexed text. The migration header says
 * why the key table exists rather than an UNINDEXED key column.
 */
interface SearchIndex<TKey extends string, TColumn extends string> {
  readonly table: string;
  readonly keyTable: string;
  readonly keys: readonly TKey[];
  readonly columns: readonly TColumn[];
}

export const PROFILE_NAME_SEARCH = {
  table: "profiles_fts",
  keyTable: "profiles_fts_keys",
  keys: ["user_id"],
  columns: ["full_name", "preferred_name"],
} as const satisfies SearchIndex<string, string>;

export const EMAIL_SEARCH = {
  table: "user_emails_fts",
  keyTable: "user_emails_fts_keys",
  keys: ["email_id", "user_id"],
  columns: ["email"],
} as const satisfies SearchIndex<string, string>;

export const GEAR_ITEM_NOTES_SEARCH = {
  table: "gear_items_fts",
  keyTable: "gear_items_fts_keys",
  keys: ["item_id"],
  columns: ["notes_markdown"],
} as const satisfies SearchIndex<string, string>;

export const GEAR_MODEL_SEARCH = {
  table: "gear_models_fts",
  keyTable: "gear_models_fts_keys",
  keys: ["model_id"],
  columns: ["manufacturer", "name"],
} as const satisfies SearchIndex<string, string>;

/**
 * The trigram tokenizer indexes three-character windows, so a needle
 * shorter than this has no trigram to look up and a MATCH on it returns
 * nothing at all. Counted in code points, which is what the tokenizer
 * counts.
 */
const TRIGRAM_LENGTH = 3;

/**
 * `target IN (ids of rows whose indexed text contains query)` — the
 * indexed replacement for OR-ing `likeContains` across a table's prose
 * columns. Matching is a case-insensitive SUBSTRING match, the same
 * semantics `likeContains` has, because the index is trigram rather
 * than word-based (see the migration header for why).
 *
 * `columns` narrows the match to some of the index's columns, so a
 * call site that searched only `full_name` keeps doing exactly that
 * even though the index also holds `preferred_name`.
 *
 * Two things this has to get right that a bare `MATCH ?` does not:
 *
 * - **User input is quoted as one FTS5 string.** Unquoted, FTS5 parses
 *   the query language — `"`, `*`, `-`, `:`, `(`, `AND`/`OR`/`NOT` —
 *   and malformed input is a SQL *error*, not a bad match. Inside a
 *   string every character is literal, and a `"` is escaped by doubling
 *   it. With the trigram tokenizer, `%` and `_` were never wildcards, so
 *   nothing else needs escaping.
 * - **A needle under three characters falls back to `likeContains`**
 *   over the FTS table's own columns. That is a scan, but of the narrow
 *   index table rather than the base table, and it keeps a two-letter
 *   search answering the way it always has instead of silently
 *   returning nothing.
 *
 * The subqueries are uncorrelated, so SQLite evaluates them once per
 * statement and probes the result per outer row.
 */
export function searchMatches<TKey extends string, TColumn extends string>(
  target: AnySQLiteColumn,
  index: SearchIndex<TKey, TColumn>,
  key: NoInfer<TKey>,
  query: string,
  columns: readonly NoInfer<TColumn>[] = index.columns,
): SQL {
  const narrowed = new Set(columns);
  if (narrowed.size === 0) {
    // An empty OR is a syntax error on one path and an empty column
    // filter (`{} :`) a syntax error on the other; refuse it here, where
    // the message can say what went wrong.
    throw new Error(`searchMatches: no columns given for ${index.table}`);
  }
  const table = sql.identifier(index.table);
  const keyTable = sql.identifier(index.keyTable);

  const matchedRowids =
    [...query].length < TRIGRAM_LENGTH
      ? sql`SELECT ${table}.rowid FROM ${table} WHERE ${sql.join(
          [...narrowed].map((column) =>
            likeContains(sql`${table}.${sql.identifier(column)}`, query),
          ),
          sql` OR `,
        )}`
      : sql`SELECT ${table}.rowid FROM ${table} WHERE ${table} MATCH ${matchExpression(index, query, narrowed)}`;

  return sql`${target} IN (SELECT ${keyTable}.${sql.identifier(key)} FROM ${keyTable} WHERE ${keyTable}.id IN (${matchedRowids}))`;
}

function matchExpression<TColumn extends string>(
  index: SearchIndex<string, TColumn>,
  query: string,
  columns: ReadonlySet<TColumn>,
): string {
  const phrase = `"${query.replaceAll('"', '""')}"`;
  // Every indexed column is the default target of a MATCH, so a column
  // filter is only emitted when it actually narrows anything. Compared
  // as sets, so a repeated column can't pass for full coverage.
  return index.columns.every((column) => columns.has(column))
    ? phrase
    : `{${[...columns].join(" ")}} : ${phrase}`;
}
