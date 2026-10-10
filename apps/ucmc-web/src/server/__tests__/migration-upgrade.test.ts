import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Migration UPGRADE tests: do the migrations survive contact with data?
 *
 * Every other workers-pool test builds a fresh database from all
 * migrations at once (`test/apply-migrations.ts`), which only ever proves
 * the end state is reachable from nothing. Production is never empty. A
 * migration that drops a column before copying it out, backfills with a
 * predicate that misses half the rows, or rebuilds a table and forgets an
 * index, passes a from-scratch run and loses data on the real database.
 *
 * These tests apply a PREFIX of the migrations, seed rows the way a live
 * database would hold them, apply the remainder, and assert on what
 * survived.
 *
 * They run against `env.MIGRATIONS_DB`, a second D1 binding declared in
 * `vitest.workers.config.ts` and deliberately left un-migrated — the
 * setup file brings `env.DB` to head before every file, which leaves no
 * intermediate state to upgrade *from*.
 *
 * **Add a case whenever a migration rewrites data**, not merely when one
 * changes the schema. The 0025 case below is the pattern: it exists
 * because that migration copies `users.email` into a new table and then
 * drops the column, so the copy is the only thing standing between a
 * deploy and every address in the database.
 */

/** Migration file names, in the order `readD1Migrations` returns them. */
const migrationNames = () => env.TEST_MIGRATIONS.map((m) => m.name);

/**
 * Apply migrations up to AND INCLUDING `name`.
 *
 * Takes a name rather than an index so a case reads as the boundary it
 * actually cares about, and so inserting a migration earlier in the
 * sequence shifts the prefix automatically instead of silently moving a
 * hard-coded slice point onto the wrong migration.
 */
async function applyThrough(name: string): Promise<void> {
  const names = migrationNames();
  const index = names.indexOf(name);
  expect(
    index,
    `no migration named "${name}" — it was renamed or removed, and this ` +
      `test's boundary needs to move with it. Available: ${names.join(", ")}`,
  ).toBeGreaterThanOrEqual(0);

  await applyD1Migrations(
    env.MIGRATIONS_DB,
    env.TEST_MIGRATIONS.slice(0, index + 1),
  );
}

/** Apply everything still outstanding, bringing the database to head. */
async function applyRest(): Promise<void> {
  // `applyD1Migrations` records what it has run in `d1_migrations` and
  // skips those, so handing it the full list applies exactly the tail.
  await applyD1Migrations(env.MIGRATIONS_DB, env.TEST_MIGRATIONS);
}

/**
 * Drop everything in the scratch database, including `d1_migrations`, so
 * the next case starts from nothing.
 *
 * Storage isolation in this pool is per FILE, not per test, so without
 * this the first case would leave the database at head and every later
 * case would silently apply no migrations at all — and pass, having
 * tested the schema it was handed rather than the upgrade it claims to.
 *
 * Drops are retried rather than ordered: a table referenced by a foreign
 * key cannot go first, and working out a topological order here would be
 * a second implementation of the dependency graph the migrations already
 * encode.
 */
async function resetScratchDatabase(): Promise<void> {
  for (let pass = 0; pass < 20; pass += 1) {
    const { results } = await env.MIGRATIONS_DB.prepare(
      // `_cf_METADATA` is D1's own bookkeeping table and is not ours to
      // drop — the attempt fails with SQLITE_AUTH, which would otherwise
      // look exactly like the "stuck" case below and wedge the sweep.
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table', 'view')
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'`,
    ).all<{ name: string; type: string }>();

    if (results.length === 0) {
      return;
    }

    let dropped = 0;
    for (const { name, type } of results) {
      try {
        await env.MIGRATIONS_DB.prepare(
          `DROP ${type === "view" ? "VIEW" : "TABLE"} IF EXISTS "${name}"`,
        ).run();
        dropped += 1;
      } catch {
        // Still referenced; a later pass gets it.
      }
    }

    expect(
      dropped,
      `could not drop any of ${results.length} remaining objects — ` +
        `the scratch database is stuck and later cases would test nothing`,
    ).toBeGreaterThan(0);
  }

  throw new Error("scratch database still not empty after 20 drop passes");
}

const columnNames = async (table: string): Promise<string[]> => {
  const { results } = await env.MIGRATIONS_DB.prepare(
    `PRAGMA table_info("${table}")`,
  ).all<{ name: string }>();
  return results.map((r) => r.name);
};

beforeEach(resetScratchDatabase);

describe("0025_user_emails backfills every address before dropping the column", () => {
  // The migration copies `users.email` into a new `user_emails` table and
  // then drops the column in the same transaction. If the INSERT…SELECT
  // ever stops matching every row — a WHERE clause added for one case, a
  // join that turns inner — the addresses are gone with no way back, and
  // a from-scratch migration run cannot tell us, because from scratch
  // there is nothing to copy.
  const BEFORE = "0024_feedback_drop_question_kind.sql";

  const SEEDED = [
    // Deliberately mixed case: the backfill lowercases, and that is the
    // behaviour sign-in depends on.
    { id: "usr_upper", email: "Officer.Example@UC.EDU", createdAt: 1_700_000 },
    { id: "usr_lower", email: "member@uc.edu", createdAt: 1_700_001 },
  ] as const;

  beforeEach(async () => {
    await applyThrough(BEFORE);

    for (const user of SEEDED) {
      await env.MIGRATIONS_DB.prepare(
        `INSERT INTO users (id, email, status, created_at)
         VALUES (?, ?, 'approved', ?)`,
      )
        .bind(user.id, user.email, user.createdAt)
        .run();
    }

    await applyRest();
  });

  it("gives every pre-existing user exactly one row", async () => {
    const { results } = await env.MIGRATIONS_DB.prepare(
      `SELECT user_id, COUNT(*) AS n FROM user_emails GROUP BY user_id`,
    ).all<{ user_id: string; n: number }>();

    expect(
      results.map((r) => [r.user_id, r.n]).sort(),
      "a user that existed before 0025 ended up with no address, or more than one",
    ).toEqual([
      ["usr_lower", 1],
      ["usr_upper", 1],
    ]);
  });

  it("lowercases the address and marks it primary and verified", async () => {
    const row = await env.MIGRATIONS_DB.prepare(
      `SELECT email, is_primary, verified_at FROM user_emails WHERE user_id = ?`,
    )
      .bind("usr_upper")
      .first<{ email: string; is_primary: number; verified_at: number }>();

    // Lowercasing is not cosmetic: every later lookup compares against a
    // lowercased address, so a row that kept its capitals is a user who
    // can no longer sign in.
    expect(row?.email).toBe("officer.example@uc.edu");
    expect(row?.is_primary).toBe(1);
    // The migration treats the existing address as de-facto verified, as
    // of the user's own creation time — not as of the migration run.
    expect(row?.verified_at).toBe(1_700_000);
  });

  it("drops users.email only after the copy, and keeps the user rows", async () => {
    expect(await columnNames("users")).not.toContain("email");

    const { results } = await env.MIGRATIONS_DB.prepare(
      `SELECT id FROM users ORDER BY id`,
    ).all<{ id: string }>();
    expect(results.map((r) => r.id)).toEqual(["usr_lower", "usr_upper"]);
  });

  it("carries the uniqueness guarantee over to the new table", async () => {
    // `users_email_unique` is dropped by this migration;
    // `user_emails_email_unique` has to be what replaces it. Losing it
    // would let two accounts claim one address, which is an auth bug,
    // not a data-tidiness one.
    await expect(
      env.MIGRATIONS_DB.prepare(
        `INSERT INTO user_emails (id, user_id, email, is_primary, verified_at, created_at)
         VALUES ('uem_dupe', 'usr_lower', 'member@uc.edu', 0, 1, 1)`,
      ).run(),
      // Matched on the specific constraint, not just "it threw": a NOT
      // NULL or CHECK failure would otherwise let this pass while the
      // unique index was quietly missing.
    ).rejects.toThrow(/UNIQUE constraint failed: user_emails\.email/);
  });
});

describe("0071_users_public_id_not_null closes the public-id hole", () => {
  // 0008 could not add `public_id` as NOT NULL (SQLite's ALTER TABLE ADD
  // COLUMN cannot, without a default), so the constraint was never
  // applied and `schema.ts` has claimed `.notNull()` ever since. 0071
  // backfills whatever is missing and enforces presence with a trigger
  // pair rather than rebuilding the table.
  //
  // It is NOT a rebuild on purpose, and that is the thing most likely
  // to be "corrected" by someone later: the create-copy-drop-rename
  // recipe cannot be done on D1. It needs `PRAGMA foreign_keys = OFF`,
  // SQLite makes that pragma a no-op inside a transaction, and D1 runs
  // each migration file as one implicitly transactional batch. `users`
  // is the parent of 40 foreign key edges across 28 tables, so the
  // rebuild reports success while deleting the rows behind 7 cascade
  // edges and blanking the columns behind 32 SET NULL ones. The
  // child-survival cases below are what would catch that.
  const BEFORE = "0070_gear_model_manufactured_at.sql";

  /** Seeded with a public id, the way every live row actually looks. */
  const WITH_ID = { id: "usr_has_id", publicId: "abc123def456" } as const;
  /** The row 0008 could not have produced, but nothing prevented. */
  const WITHOUT_ID = { id: "usr_null_id" } as const;

  beforeEach(async () => {
    await applyThrough(BEFORE);

    for (const id of [WITH_ID.id, WITHOUT_ID.id]) {
      await env.MIGRATIONS_DB.prepare(
        `INSERT INTO users (id, status, created_at) VALUES (?, 'approved', 1700000)`,
      )
        .bind(id)
        .run();
    }
    // Only one of the two gets a public id. That the other INSERT is
    // accepted at all is the defect under test — before 0071 the column
    // is nullable and the unique index permits unlimited NULLs.
    await env.MIGRATIONS_DB.prepare(
      `UPDATE users SET public_id = ? WHERE id = ?`,
    )
      .bind(WITH_ID.publicId, WITH_ID.id)
      .run();

    // Children across three shapes, all ON DELETE CASCADE: a plain
    // child, a composite-PK join table, and the table the 0025 case
    // already guards. All of them vanish if this migration is ever
    // swapped for a table rebuild.
    const role = await env.MIGRATIONS_DB.prepare(
      `SELECT id FROM roles LIMIT 1`,
    ).first<{ id: string }>();
    expect(
      role,
      "migrations seed no roles, so this case cannot bind one",
    ).not.toBeNull();

    for (const userId of [WITH_ID.id, WITHOUT_ID.id]) {
      await env.MIGRATIONS_DB.prepare(
        `INSERT INTO user_emails (id, user_id, email, is_primary, verified_at, created_at)
         VALUES (?, ?, ?, 1, 1700000, 1700000)`,
      )
        .bind(`uem_${userId}`, userId, `${userId}@uc.edu`)
        .run();
      await env.MIGRATIONS_DB.prepare(
        `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
         VALUES (?, ?, 1700000, 1700000, 1800000)`,
      )
        .bind(`ses_${userId}`, userId)
        .run();
      await env.MIGRATIONS_DB.prepare(
        `INSERT INTO emergency_contacts (id, user_id, name, phone, relationship, created_at)
         VALUES (?, ?, 'Kin', '+15135550101', 'parent', 1700000)`,
      )
        .bind(`eme_${userId}`, userId)
        .run();
      await env.MIGRATIONS_DB.prepare(
        `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`,
      )
        .bind(userId, role!.id)
        .run();
    }

    await applyRest();
  });

  it("backfills the row that had no public id", async () => {
    const row = await env.MIGRATIONS_DB.prepare(
      `SELECT public_id FROM users WHERE id = ?`,
    )
      .bind(WITHOUT_ID.id)
      .first<{ public_id: string }>();

    // Shape matters as much as presence: the value lands in the same
    // URLs and the same unique index as one `generatePublicId()`
    // produced, so it has to pass for one — 12 chars, lowercase.
    expect(row?.public_id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("leaves an existing public id exactly as it was", async () => {
    const row = await env.MIGRATIONS_DB.prepare(
      `SELECT public_id, status, created_at FROM users WHERE id = ?`,
    )
      .bind(WITH_ID.id)
      .first<{ public_id: string; status: string; created_at: number }>();

    // A backfill whose WHERE clause reached further than NULL rows
    // would reissue public ids and break every /members/$publicId link
    // in existence — silently, since the new value is just as valid.
    expect(row?.public_id).toBe(WITH_ID.publicId);
    expect(row?.status).toBe("approved");
    expect(row?.created_at).toBe(1700000);
  });

  it.each([
    [
      "an insert that omits the column",
      `INSERT INTO users (id, status, created_at)
       VALUES ('usr_omitted', 'approved', 1700000)`,
    ],
    [
      "an insert that passes NULL explicitly",
      `INSERT INTO users (id, public_id, status, created_at)
       VALUES ('usr_explicit_null', NULL, 'approved', 1700000)`,
    ],
  ])("rejects %s", async (_label, sql) => {
    // Both shapes, because the two raw-SQL writers that bypass Drizzle
    // (`drizzle/seed.ts` and seed-admin.yml) would produce the first if
    // someone dropped the column from their statement, and the second
    // if a shell variable came through empty.
    await expect(env.MIGRATIONS_DB.prepare(sql).run()).rejects.toThrow(
      /NOT NULL constraint failed: users\.public_id/,
    );
  });

  it("rejects an update that nulls the column back out", async () => {
    await expect(
      env.MIGRATIONS_DB.prepare(
        `UPDATE users SET public_id = NULL WHERE id = ?`,
      )
        .bind(WITH_ID.id)
        .run(),
    ).rejects.toThrow(/NOT NULL constraint failed: users\.public_id/);
  });

  it("still accepts a well-formed insert and an unrelated update", async () => {
    // The other half of a trigger: one that over-fires is a worse bug
    // than the hole it closed, because it breaks sign-up rather than
    // one member page.
    await env.MIGRATIONS_DB.prepare(
      `INSERT INTO users (id, public_id, status, created_at)
       VALUES ('usr_fresh', 'fed210cba987', 'approved', 1700000)`,
    ).run();

    // `BEFORE UPDATE OF public_id` must not fire for a column it does
    // not name, even on a row it would otherwise match.
    await env.MIGRATIONS_DB.prepare(
      `UPDATE users SET status = 'deactivated' WHERE id = 'usr_fresh'`,
    ).run();

    const row = await env.MIGRATIONS_DB.prepare(
      `SELECT public_id, status FROM users WHERE id = 'usr_fresh'`,
    ).first<{ public_id: string; status: string }>();
    expect(row?.public_id).toBe("fed210cba987");
    expect(row?.status).toBe("deactivated");
  });

  it("still rejects a duplicate public id", async () => {
    // `users_public_id_unique` is untouched by this migration, which is
    // itself worth pinning: the rebuild this replaced would have had to
    // recreate it by hand.
    await expect(
      env.MIGRATIONS_DB.prepare(
        `INSERT INTO users (id, public_id, status, created_at)
         VALUES ('usr_dupe', ?, 'approved', 1700000)`,
      )
        .bind(WITH_ID.publicId)
        .run(),
    ).rejects.toThrow(/UNIQUE constraint failed: users\.public_id/);
  });

  it.each(["user_emails", "sessions", "emergency_contacts", "user_roles"])(
    "leaves %s rows untouched",
    async (table) => {
      const row = await env.MIGRATIONS_DB.prepare(
        `SELECT COUNT(*) AS n FROM "${table}" WHERE user_id IN (?, ?)`,
      )
        .bind(WITH_ID.id, WITHOUT_ID.id)
        .first<{ n: number }>();

      // Two seeded rows per table, one per user. Zero here means
      // something dropped `users` — the cascade this migration exists
      // to avoid, which raises no error and leaves a valid schema.
      expect(
        row?.n,
        `${table} lost its rows; something dropped "users" while 28 ` +
          `tables still referenced it`,
      ).toBe(2);
    },
  );

  it("keeps every foreign key into users intact", async () => {
    const { results: tables } = await env.MIGRATIONS_DB.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
       ORDER BY name`,
    ).all<{ name: string }>();

    const edges: string[] = [];
    for (const { name } of tables) {
      const { results: fks } = await env.MIGRATIONS_DB.prepare(
        `PRAGMA foreign_key_list("${name}")`,
      ).all<{ table: string }>();
      edges.push(...fks.filter((fk) => fk.table === "users").map(() => name));
    }

    // Counted, not listed, so adding a table that references `users`
    // does not fail this — while a rebuild that silently dropped the
    // references still does. 40 edges across 28 tables when 0071
    // landed; the edge count is what the cascade risk scales with, so
    // it is the number worth pinning.
    expect(
      edges.length,
      `only ${edges.length} foreign key edges into users remain`,
    ).toBeGreaterThanOrEqual(40);
  });

  it("reports no foreign key violations anywhere", async () => {
    const { results } = await env.MIGRATIONS_DB.prepare(
      `PRAGMA foreign_key_check`,
    ).all<{ table: string; parent: string }>();

    expect(
      results,
      `orphaned rows after 0071: ${results
        .map((r) => `${r.table} -> ${r.parent}`)
        .join(", ")}`,
    ).toEqual([]);
  });
});

describe("0081_search_fts backfills every searchable row", () => {
  // The triggers only see writes made after the migration. Every member,
  // address and piece of gear that already existed reaches the indexes
  // through the INSERT…SELECT backfill alone, so a backfill that missed a
  // table would leave those rows unsearchable — from-scratch runs start
  // empty and cannot see it.
  const BEFORE = "0080_analytics_permission.sql";

  beforeEach(async () => {
    await applyThrough(BEFORE);

    const seed = [
      `INSERT INTO users (id, public_id, status) VALUES ('usr_fts', 'ftsftsftsfts', 'approved')`,
      `INSERT INTO profiles (user_id, full_name, preferred_name, phone, uc_affiliation)
       VALUES ('usr_fts', 'Robin Goldsmith', 'Robbie', '+15135550100', 'student')`,
      `INSERT INTO user_emails (id, user_id, email, is_primary, verified_at)
       VALUES ('uem_fts', 'usr_fts', 'robin.goldsmith@mail.uc.edu', 1, 1)`,
      `INSERT INTO gear_types (id, public_id, name) VALUES ('gt_fts', 'gtfts', 'Harness')`,
      `INSERT INTO gear_models (id, public_id, type_id, manufacturer, name)
       VALUES ('gm_fts', 'gmfts', 'gt_fts', 'Black Diamond', 'Momentum')`,
      `INSERT INTO gear_items (id, public_id, model_id, code, notes_markdown)
       VALUES ('gi_fts', 'gifts', 'gm_fts', 'HA1', 'Buckle replaced in 2024')`,
    ];
    for (const statement of seed) {
      await env.MIGRATIONS_DB.prepare(statement).run();
    }

    await applyRest();
  });

  it.each([
    ["profiles_fts", "user_id", "mith", "usr_fts"],
    ["profiles_fts", "user_id", "robbie", "usr_fts"],
    ["user_emails_fts", "email_id", "goldsmith@mail", "uem_fts"],
    ["gear_models_fts", "model_id", "diamond", "gm_fts"],
    ["gear_items_fts", "item_id", "buckle", "gi_fts"],
  ])("%s finds the pre-existing row by %s", async (table, key, needle, id) => {
    const { results } = await env.MIGRATIONS_DB.prepare(
      `SELECT k.${key} AS id FROM ${table}_keys k
       JOIN ${table} f ON f.rowid = k.id WHERE ${table} MATCH ?`,
    )
      .bind(`"${needle}"`)
      .all<{ id: string }>();
    expect(
      results.map((r) => r.id),
      `${table} has no entry for a row that existed before 0081`,
    ).toEqual([id]);
  });
});

describe("a populated database upgrades across the most recent migration", () => {
  // Deliberately expressed as "the last one", not as a file name: the
  // newest migration is the one nobody has run against real data yet, so
  // this case should follow head automatically rather than need a rename
  // every time one lands.
  //
  // The seed stays in the core auth tables on purpose. They are the ones
  // whose loss is unrecoverable and the ones least likely to churn, so
  // this case keeps working as migrations accumulate. A migration that
  // rewrites data in its own area should get its own case above rather
  // than widen this seed.
  beforeEach(async () => {
    const names = migrationNames();
    expect(names.length, "expected more than one migration").toBeGreaterThan(1);

    await applyThrough(names[names.length - 2]);

    // `public_id` is spelled out rather than left to default, because
    // this seed runs against head-minus-one and 0071 installed a trigger
    // pair that rejects a users row without one. Omitting it worked only
    // while 0071 was itself the newest migration and therefore outside
    // the applied prefix — the next migration to land moved it inside,
    // and the seed started failing for a reason that said nothing about
    // the migration under test. A live row always has one anyway, which
    // is what this seed is supposed to look like.
    await env.MIGRATIONS_DB.prepare(
      `INSERT INTO users (id, public_id, status, created_at)
       VALUES ('usr_keep', 'aaaabbbbcccc', 'approved', 1700000)`,
    ).run();
    await env.MIGRATIONS_DB.prepare(
      `INSERT INTO user_emails (id, user_id, email, is_primary, verified_at, created_at)
       VALUES ('uem_keep', 'usr_keep', 'keep@uc.edu', 1, 1700000, 1700000)`,
    ).run();

    await applyRest();
  });

  it("keeps the rows that were already there", async () => {
    const user = await env.MIGRATIONS_DB.prepare(
      `SELECT id, status FROM users WHERE id = 'usr_keep'`,
    ).first<{ id: string; status: string }>();
    expect(
      user,
      "the newest migration dropped a pre-existing user row",
    ).not.toBeNull();
    expect(user?.status).toBe("approved");

    const email = await env.MIGRATIONS_DB.prepare(
      `SELECT email, is_primary FROM user_emails WHERE user_id = 'usr_keep'`,
    ).first<{ email: string; is_primary: number }>();
    expect(email?.email).toBe("keep@uc.edu");
    expect(email?.is_primary).toBe(1);
  });

  it("still enforces the foreign key into users", async () => {
    // A rebuild-and-copy migration (the SQLite idiom for altering a
    // constraint) is the easy way to lose a foreign key: the new table
    // gets created without it and everything keeps working until an
    // orphan row appears months later.
    await expect(
      env.MIGRATIONS_DB.prepare(
        `INSERT INTO user_emails (id, user_id, email, is_primary, verified_at, created_at)
         VALUES ('uem_orphan', 'usr_does_not_exist', 'orphan@uc.edu', 0, 1, 1)`,
      ).run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it("reaches the same head a from-scratch run reaches", async () => {
    // The from-scratch path is what every other test in this pool builds,
    // so if the upgraded database disagrees with it, one of the two is
    // lying about what production looks like.
    const { results: applied } = await env.MIGRATIONS_DB.prepare(
      `SELECT name FROM d1_migrations ORDER BY name`,
    ).all<{ name: string }>();

    expect(applied.map((r) => r.name)).toEqual([...migrationNames()].sort());
  });
});
