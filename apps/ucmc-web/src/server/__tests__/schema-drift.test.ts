import { env } from "cloudflare:test";
import { is } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import * as schema from "../../../drizzle/schema.ts";

/**
 * Schema-drift gate: does `drizzle/schema.ts` still describe the database
 * the migrations actually produce?
 *
 * Nothing else checks this. Migrations are hand-written SQL (see
 * CLAUDE.md — `db:generate` cannot run against the meta snapshots, which
 * have been stale since 0059), and `schema.ts` is hand-edited beside
 * them. The two are related only by whoever wrote them remembering to do
 * both. When they disagree, Drizzle keeps generating SQL against the
 * shape it believes in: a column it thinks is nullable but isn't turns
 * every insert that omits it into a runtime NOT NULL failure, and an
 * index it believes exists turns a query plan into a table scan that
 * nothing reports.
 *
 * `tsc` cannot see any of this — `schema.ts` typechecks perfectly against
 * a table that does not exist.
 *
 * The comparison runs against `env.DB`, which `test/apply-migrations.ts`
 * has brought to head from the real migration files, so "what the
 * migrations produce" is literal rather than inferred from a snapshot.
 */

interface PragmaColumn {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

interface PragmaIndex {
  name: string;
  unique: number;
  partial: number;
}

/**
 * Drift that is real, known, and not this test's to fix.
 *
 * An entry here does NOT suppress the check — it inverts it. The test
 * asserts the database still has the wrong shape, so whoever lands the
 * migration that corrects it gets a failure telling them to delete the
 * entry. Silence would let a fixed problem leave a permanent hole in the
 * gate, which is the failure mode an allowlist usually has.
 *
 * Keyed `table.column`; the value is why it is still here.
 */
const KNOWN_NULLABILITY_DRIFT: Record<string, string> = {
  // `0008_user_public_id` adds the column, backfills every existing row,
  // and indexes it — but SQLite's ALTER TABLE ADD COLUMN cannot add a
  // NOT NULL column without a default, so the constraint was never
  // applied and nothing has tightened it since. schema.ts has said
  // `.notNull()` the whole time.
  //
  // The data is fine: every row was backfilled and every insert goes
  // through Drizzle, which always supplies it. The hole is the missing
  // constraint — and because SQLite permits multiple NULLs in a UNIQUE
  // index, a raw-SQL insert that omitted it could produce several users
  // with no public id and no error.
  //
  // Closing it needs a table rebuild (create-copy-drop-rename, with the
  // foreign keys and indexes recreated), which is a data-model change
  // with its own review, not a testing change. Tracked separately.
  "users.public_id": "0008 could not add NOT NULL; never tightened",
};

/** Every `sqliteTable` exported from `drizzle/schema.ts`, by its SQL name. */
// Widened to `unknown[]` first: `schema.ts` also exports the enum tuples
// (`userStatus`, `affiliation`, …), so the union `Object.values` infers
// is not a supertype of `SQLiteTable` and the type predicate below is
// rejected against it.
const schemaExports: unknown[] = Object.values(schema);

const declaredTables = schemaExports
  .filter((value): value is SQLiteTable => is(value, SQLiteTable))
  .map((table) => ({ table, config: getTableConfig(table) }))
  .sort((a, b) => a.config.name.localeCompare(b.config.name));

async function pragma<T>(query: string): Promise<T[]> {
  const { results } = await env.DB.prepare(query).all<T>();
  return results;
}

it("finds tables to check", () => {
  // A guard against the whole suite below silently becoming a no-op: if
  // the export shape of schema.ts ever changes such that `is(…,
  // SQLiteTable)` stops matching, every `describe.each` below would
  // iterate an empty list and the file would pass having checked nothing.
  expect(declaredTables.length).toBeGreaterThan(40);
});

describe.each(declaredTables)("$config.name", ({ config }) => {
  const tableName = config.name;

  it("exists in the migrated database", async () => {
    const rows = await pragma<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}'`,
    );
    expect(
      rows,
      `schema.ts declares table "${tableName}" but no migration creates it`,
    ).toHaveLength(1);
  });

  it("has exactly the declared columns", async () => {
    const actual = await pragma<PragmaColumn>(
      `PRAGMA table_info("${tableName}")`,
    );

    const actualNames = actual.map((c) => c.name).sort();
    const declaredNames = config.columns.map((c) => c.name).sort();

    // Compared as sets, not as an ordered list: SQLite column order is a
    // property of how a table was built and rebuilt, and an ALTER TABLE
    // ADD COLUMN always appends. Holding schema.ts to that order would
    // fail on a difference that cannot matter.
    expect(
      actualNames,
      `columns disagree for "${tableName}" — ` +
        `only in the database: [${actualNames.filter((n) => !declaredNames.includes(n)).join(", ")}], ` +
        `only in schema.ts: [${declaredNames.filter((n) => !actualNames.includes(n)).join(", ")}]`,
    ).toEqual(declaredNames);
  });

  it("agrees on nullability and type for every column", async () => {
    const actual = await pragma<PragmaColumn>(
      `PRAGMA table_info("${tableName}")`,
    );
    const byName = new Map(actual.map((c) => [c.name, c]));

    for (const column of config.columns) {
      const live = byName.get(column.name);
      if (!live) {
        continue; // the column test above owns this failure
      }

      // Nullability is the half that bites hardest: Drizzle omits a
      // nullable column from an insert, so believing a NOT NULL column is
      // optional produces a runtime constraint failure on a code path
      // that typechecks.
      const knownDrift = KNOWN_NULLABILITY_DRIFT[`${tableName}.${column.name}`];

      // Expressed as "what should the database say", then asserted once.
      // Branching around two different `expect` calls would make the
      // assertion conditional, and an assertion inside a branch is one
      // that silently does nothing when the branch isn't taken —
      // `vitest/no-conditional-expect` is right to refuse it.
      const expectedNotNull = knownDrift ? !column.notNull : column.notNull;

      expect(
        live.notnull === 1,
        knownDrift
          ? `"${tableName}"."${column.name}" is recorded as known drift ` +
              `(${knownDrift}) but now MATCHES schema.ts — the migration ` +
              `landed, so delete its entry from KNOWN_NULLABILITY_DRIFT ` +
              `rather than leaving this column unguarded`
          : `"${tableName}"."${column.name}": database says ` +
              `${live.notnull === 1 ? "NOT NULL" : "nullable"}, ` +
              `schema.ts says ${column.notNull ? "NOT NULL" : "nullable"}`,
      ).toBe(expectedNotNull);

      // SQLite stores the declared type verbatim, so this is a string
      // comparison against the DDL rather than against a resolved
      // affinity. Case-insensitive because the migrations are
      // hand-written and inconsistent about it.
      expect(
        live.type.toLowerCase(),
        `"${tableName}"."${column.name}" declared type`,
      ).toBe(column.getSQLType().toLowerCase());
    }
  });

  it("agrees on the primary key", async () => {
    const actual = await pragma<PragmaColumn>(
      `PRAGMA table_info("${tableName}")`,
    );

    // PRAGMA reports `pk` as a 1-based position within a composite key,
    // 0 for non-key columns — so ordering by it recovers the key's own
    // column order, which for a composite key is part of its meaning.
    const livePk = actual
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);

    const declaredPk = config.primaryKeys[0]?.columns.map((c) => c.name) ?? [
      ...config.columns.filter((c) => c.primary).map((c) => c.name),
    ];

    expect(livePk, `primary key of "${tableName}"`).toEqual(declaredPk);
  });

  it("has every index schema.ts declares", async () => {
    const live = await pragma<PragmaIndex>(`PRAGMA index_list("${tableName}")`);

    // `sqlite_autoindex_*` are the implicit indexes SQLite builds for
    // UNIQUE and non-INTEGER PRIMARY KEY constraints. They have no name in
    // the DDL and no counterpart in schema.ts, so comparing them would
    // report drift on every table with a text primary key.
    const liveByName = new Map(
      live
        .filter((i) => !i.name.startsWith("sqlite_autoindex"))
        .map((i) => [i.name, i]),
    );

    for (const index of config.indexes) {
      const name = index.config.name;
      const liveIndex = liveByName.get(name);

      expect(
        liveIndex,
        `schema.ts declares index "${name}" on "${tableName}", ` +
          `but the migrated database has only ` +
          `[${[...liveByName.keys()].join(", ")}]`,
      ).toBeDefined();

      // A unique index that migrated as non-unique is a constraint that
      // silently stopped being enforced — the failure mode is duplicate
      // rows appearing months later, not an error at deploy time.
      expect(liveIndex?.unique === 1, `index "${name}" uniqueness`).toBe(
        Boolean(index.config.unique),
      );
    }
  });
});
