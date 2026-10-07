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

    await env.MIGRATIONS_DB.prepare(
      `INSERT INTO users (id, status, created_at) VALUES ('usr_keep', 'approved', 1700000)`,
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
