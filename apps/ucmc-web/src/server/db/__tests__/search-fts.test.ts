import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb, schema } from "#/server/db";
import {
  EMAIL_SEARCH,
  GEAR_ITEM_NOTES_SEARCH,
  GEAR_MODEL_SEARCH,
  PROFILE_NAME_SEARCH,
  searchMatches,
} from "#/server/db/search";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

/**
 * The trigram indexes from `0081_search_fts.sql` and the `searchMatches`
 * helper that reads them. Three things are pinned here:
 *
 * - the TypeScript descriptors agree with the migrated tables, since
 *   Drizzle cannot model a virtual table and nothing else would notice
 *   a rename on one side;
 * - every trigger exists and keeps its index in step with the base
 *   table, foreign-key cascades included — the triggers are dropped by
 *   any future rebuild of their table, and a missing one fails quietly
 *   as a search that stops finding new rows;
 * - user input is matched literally: FTS5 has its own query language,
 *   in which a stray `"` or `*` is a syntax error rather than a bad match.
 */

const INDEXES = [
  PROFILE_NAME_SEARCH,
  EMAIL_SEARCH,
  GEAR_ITEM_NOTES_SEARCH,
  GEAR_MODEL_SEARCH,
];

const BASE_TABLES = ["profiles", "user_emails", "gear_items", "gear_models"];

async function seedMember(
  id: string,
  fullName: string,
  preferredName: string,
  email: string,
): Promise<void> {
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: id.slice(-12).padStart(12, "0"),
      status: "approved",
    });
  await attachPrimaryEmail(id, email);
  await getDb().insert(schema.profiles).values({
    userId: id,
    fullName,
    preferredName,
    phone: "+15135550100",
    ucAffiliation: "student",
  });
}

/** User ids matching `query` on the given name columns, sorted. */
async function membersMatching(
  query: string,
  columns: readonly (
    "full_name" | "preferred_name"
  )[] = PROFILE_NAME_SEARCH.columns,
): Promise<string[]> {
  const rows = await getDb()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      searchMatches(
        schema.users.id,
        PROFILE_NAME_SEARCH,
        "user_id",
        query,
        columns,
      ),
    );
  return rows.map((r) => r.id).sort();
}

/** Index entries (key row joined to its FTS row) for one base id. */
async function ftsRowCount(
  index: (typeof INDEXES)[number],
  key: string,
  id: string,
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ${index.keyTable} k
     JOIN ${index.table} f ON f.rowid = k.id WHERE k.${key} = ?`,
  )
    .bind(id)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Every index agrees with its base table: one key row and one FTS row
 * per base row, no orphans on either side, and FTS5's own
 * `integrity-check` (which raises on a corrupt index) passes.
 */
async function expectIndexesConsistent(): Promise<void> {
  for (const [i, index] of INDEXES.entries()) {
    const base = BASE_TABLES[i];
    const counts = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM ${base}) AS base,
              (SELECT COUNT(*) FROM ${index.keyTable}) AS keys,
              (SELECT COUNT(*) FROM ${index.table}) AS fts`,
    ).first<{ base: number; keys: number; fts: number }>();
    expect(counts, `${index.table} drifted from ${base}`).toEqual({
      base: counts?.base,
      keys: counts?.base,
      fts: counts?.base,
    });
    await env.DB.prepare(
      `INSERT INTO ${index.table} (${index.table}) VALUES ('integrity-check')`,
    ).run();
  }
}

beforeEach(async () => {
  await getDb().delete(schema.users);
});

describe("descriptors agree with the migrated database", () => {
  it.each(INDEXES)("$table has exactly its columns", async (index) => {
    const { results } = await env.DB.prepare(
      `PRAGMA table_info("${index.table}")`,
    ).all<{ name: string }>();
    expect(results.map((r) => r.name).sort()).toEqual(
      [...index.columns].sort(),
    );
  });

  it.each(INDEXES)(
    "$keyTable has an integer id and its keys",
    async (index) => {
      const { results } = await env.DB.prepare(
        `PRAGMA table_info("${index.keyTable}")`,
      ).all<{ name: string; type: string; pk: number }>();
      expect(results.map((r) => r.name).sort()).toEqual(
        ["id", ...index.keys].sort(),
      );
      // INTEGER PRIMARY KEY is what makes `id` the rowid itself, which
      // VACUUM never renumbers — the reason the key table exists.
      expect(results.find((r) => r.name === "id")).toMatchObject({
        type: "INTEGER",
        pk: 1,
      });
    },
  );

  it.each(BASE_TABLES)(
    "%s carries its insert, update and delete triggers",
    async (table) => {
      const { results } = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND name LIKE '%_fts_%'`,
      )
        .bind(table)
        .all<{ name: string }>();
      expect(
        results.map((r) => r.name).sort(),
        `a trigger on ${table} is missing — a migration that rebuilds the ` +
          `table drops its triggers and must recreate them (see 0081)`,
      ).toEqual([
        `${table}_fts_delete`,
        `${table}_fts_insert`,
        `${table}_fts_update`,
      ]);
    },
  );
});

it.each(["profiles_fts", "user_emails_fts"])(
  "%s removes deleted personal data from the index in place",
  async (table) => {
    // Without secure-delete, a deleted member's trigrams stay in
    // `*_data` until a merge happens to rewrite their segment — see the
    // migration header.
    const row = await env.DB.prepare(
      `SELECT v FROM ${table}_config WHERE k = 'secure-delete'`,
    ).first<{ v: number }>();
    expect(row?.v).toBe(1);
  },
);

describe("matching", () => {
  beforeEach(async () => {
    await seedMember(
      "usr_gold",
      "Robin Goldsmith",
      "Robbie",
      "robin@mail.uc.edu",
    );
    await seedMember("usr_pct", "Fifty 50% Off", "Fifty", "fifty@mail.uc.edu");
    await seedMember(
      "usr_five",
      "Five Hundred 500",
      "Five",
      "five@mail.uc.edu",
    );
    await seedMember("usr_ebert", "Émile Ébert", "Em", "emile@mail.uc.edu");
    await seedMember("usr_quote", 'Jo "JJ" Quinn', "Jo", "jo@mail.uc.edu");
  });

  it("matches a substring mid-word, case-insensitively, like LIKE did", async () => {
    expect(await membersMatching("MITH")).toEqual(["usr_gold"]);
  });

  it("folds non-ASCII case from three characters up, and only there", async () => {
    expect(await membersMatching("ébert")).toEqual(["usr_ebert"]);
    // The short-needle fallback is SQLite's LIKE, which folds ASCII only.
    // Pinned so a change to either path's folding is a decision, not a
    // surprise: see the migration header.
    expect(await membersMatching("éb")).toEqual([]);
    expect(await membersMatching("Éb")).toEqual(["usr_ebert"]);
  });

  it("treats % and _ as literal characters, not wildcards", async () => {
    expect(await membersMatching("50%")).toEqual(["usr_pct"]);
    expect(await membersMatching("0_0")).toEqual([]);
  });

  // Each needle is valid or invalid FTS5 query syntax; quoted, it must be
  // a literal substring instead. The expectations are what a literal
  // match returns, so an unquoted regression fails on the valid ones too
  // (`Gold*` would prefix-match, `Robin AND Quinn` would AND).
  it.each([
    ['"JJ', ["usr_quote"]],
    ['JJ"', ["usr_quote"]],
    ["Gold*", []],
    ["-Robin", []],
    ["full_name:Robin", []],
    ["(Robin", []],
    ["Robin AND Quinn", []],
    ["Robin OR Quinn", []],
    ["NEAR(Robin)", []],
    ["^Rob", []],
  ])("matches FTS5 query syntax %j literally", async (needle, expected) => {
    expect(await membersMatching(needle)).toEqual(expected);
  });

  it("finds a name containing a double quote by that quote", async () => {
    expect(await membersMatching('"JJ"')).toEqual(["usr_quote"]);
  });

  it("falls back to LIKE below three characters instead of matching nothing", async () => {
    expect(await membersMatching("Ro")).toEqual(["usr_gold"]);
    expect(await membersMatching("%")).toEqual(["usr_pct"]);
    expect(await membersMatching("_")).toEqual([]);
  });

  it("narrows to the requested columns on both paths", async () => {
    // "Robbie" is only a preferred name.
    expect(await membersMatching("Robbie")).toEqual(["usr_gold"]);
    expect(await membersMatching("Robbie", ["full_name"])).toEqual([]);
    expect(await membersMatching("Em", ["full_name"])).toEqual([]);
    expect(await membersMatching("Em", ["preferred_name"])).toEqual([
      "usr_ebert",
    ]);
  });
});

describe("column narrowing guards", () => {
  it("refuses an empty column list rather than emitting broken SQL", () => {
    expect(() =>
      searchMatches(schema.users.id, PROFILE_NAME_SEARCH, "user_id", "abc", []),
    ).toThrow(/no columns/);
  });

  it("does not mistake a repeated column for full coverage", async () => {
    await seedMember("usr_pref", "Plain Name", "Nickname", "p@mail.uc.edu");
    expect(
      await membersMatching("Nickname", ["full_name", "full_name"]),
    ).toEqual([]);
  });
});

describe("triggers keep the indexes in step", () => {
  it("follows a profile through insert, rename and an FK cascade delete", async () => {
    await seedMember("usr_sync", "Alex Original", "Alex", "alex@mail.uc.edu");
    expect(await membersMatching("Original")).toEqual(["usr_sync"]);

    await getDb()
      .update(schema.profiles)
      .set({ fullName: "Alex Renamed" })
      .where(eq(schema.profiles.userId, "usr_sync"));
    expect(await membersMatching("Original")).toEqual([]);
    expect(await membersMatching("Renamed")).toEqual(["usr_sync"]);
    expect(await ftsRowCount(PROFILE_NAME_SEARCH, "user_id", "usr_sync")).toBe(
      1,
    );

    // Deleting the user cascades to `profiles` and `user_emails`; the
    // cascade must fire their delete triggers or the index keeps a ghost.
    await getDb().delete(schema.users).where(eq(schema.users.id, "usr_sync"));
    expect(await ftsRowCount(PROFILE_NAME_SEARCH, "user_id", "usr_sync")).toBe(
      0,
    );
    expect(await ftsRowCount(EMAIL_SEARCH, "user_id", "usr_sync")).toBe(0);
    await expectIndexesConsistent();
  });

  it("follows an email address being changed and removed", async () => {
    await seedMember(
      "usr_mail",
      "Sam Mailer",
      "Sam",
      "old.address@mail.uc.edu",
    );
    const [row] = await getDb()
      .select({ id: schema.userEmails.id })
      .from(schema.userEmails)
      .where(eq(schema.userEmails.userId, "usr_mail"));

    const byEmail = async (q: string) =>
      (
        await getDb()
          .select({ id: schema.userEmails.id })
          .from(schema.userEmails)
          .where(
            searchMatches(schema.userEmails.id, EMAIL_SEARCH, "email_id", q),
          )
      ).map((r) => r.id);

    expect(await byEmail("old.address")).toEqual([row.id]);
    await getDb()
      .update(schema.userEmails)
      .set({ email: "new.address@mail.uc.edu" })
      .where(eq(schema.userEmails.id, row.id));
    expect(await byEmail("old.address")).toEqual([]);
    expect(await byEmail("new.address")).toEqual([row.id]);

    await getDb()
      .delete(schema.userEmails)
      .where(eq(schema.userEmails.id, row.id));
    expect(await ftsRowCount(EMAIL_SEARCH, "email_id", row.id)).toBe(0);
    await expectIndexesConsistent();
  });

  it("follows gear notes and model names", async () => {
    await getDb().delete(schema.gearItems);
    await getDb().delete(schema.gearModels);
    await getDb().delete(schema.gearTypes);
    await getDb()
      .insert(schema.gearTypes)
      .values({ id: "gt_sync", publicId: "gtsync", name: "Rope" });
    await getDb().insert(schema.gearModels).values({
      id: "gm_sync",
      publicId: "gmsync",
      typeId: "gt_sync",
      manufacturer: "Beal",
      name: "Joker",
    });
    await getDb().insert(schema.gearItems).values({
      id: "gi_sync",
      publicId: "gisync",
      modelId: "gm_sync",
      code: "RO1",
      notesMarkdown: "sheath fuzzing",
    });

    const items = async (q: string) =>
      (
        await getDb()
          .select({ id: schema.gearItems.id })
          .from(schema.gearItems)
          .where(
            searchMatches(
              schema.gearItems.id,
              GEAR_ITEM_NOTES_SEARCH,
              "item_id",
              q,
            ),
          )
      ).map((r) => r.id);
    const models = async (q: string) =>
      (
        await getDb()
          .select({ id: schema.gearModels.id })
          .from(schema.gearModels)
          .where(
            searchMatches(
              schema.gearModels.id,
              GEAR_MODEL_SEARCH,
              "model_id",
              q,
            ),
          )
      ).map((r) => r.id);

    expect(await items("fuzz")).toEqual(["gi_sync"]);
    await getDb()
      .update(schema.gearItems)
      .set({ notesMarkdown: null })
      .where(eq(schema.gearItems.id, "gi_sync"));
    expect(await items("fuzz")).toEqual([]);
    expect(
      await ftsRowCount(GEAR_ITEM_NOTES_SEARCH, "item_id", "gi_sync"),
    ).toBe(1);

    expect(await models("joke")).toEqual(["gm_sync"]);
    await getDb()
      .update(schema.gearModels)
      .set({ name: "Booster" })
      .where(eq(schema.gearModels.id, "gm_sync"));
    expect(await models("joke")).toEqual([]);
    expect(await models("boost")).toEqual(["gm_sync"]);

    await getDb()
      .delete(schema.gearItems)
      .where(eq(schema.gearItems.id, "gi_sync"));
    await getDb()
      .delete(schema.gearModels)
      .where(eq(schema.gearModels.id, "gm_sync"));
    expect(
      await ftsRowCount(GEAR_ITEM_NOTES_SEARCH, "item_id", "gi_sync"),
    ).toBe(0);
    expect(await ftsRowCount(GEAR_MODEL_SEARCH, "model_id", "gm_sync")).toBe(0);
    await expectIndexesConsistent();
  });

  it("deletes by point lookup, not one index scan per deleted row", async () => {
    // A retention sweep deletes many users in one statement, and the FK
    // cascade fires the profile and email delete triggers once per user.
    // Were each trigger to scan its index, the statement would read
    // (deleted x members) rows; through the key tables it reads a small
    // constant per deleted row. Measured with D1's own `rows_read`,
    // which is also what D1 bills.
    const MEMBERS = 300;
    const DELETED = 50;
    const statements = [];
    for (let i = 0; i < MEMBERS; i += 1) {
      const id = `usr_bulk_${String(i).padStart(4, "0")}`;
      statements.push(
        env.DB.prepare(
          `INSERT INTO users (id, public_id, status) VALUES (?, ?, 'approved')`,
        ).bind(id, `bulk${String(i).padStart(8, "0")}`),
        env.DB.prepare(
          `INSERT INTO profiles (user_id, full_name, preferred_name, phone, uc_affiliation)
           VALUES (?, ?, 'Bulk', '+15135550100', 'student')`,
        ).bind(id, `Bulk Member ${i}`),
        env.DB.prepare(
          `INSERT INTO user_emails (id, user_id, email, is_primary, verified_at)
           VALUES (?, ?, ?, 1, 1)`,
        ).bind(`uem_bulk_${i}`, id, `bulk${i}@mail.uc.edu`),
      );
    }
    await env.DB.batch(statements);

    // Deleted from the base tables directly rather than through `users`,
    // whose cascade into 28 child tables would swamp the measurement
    // with reads that have nothing to do with search.
    for (const table of ["profiles", "user_emails"]) {
      const result = await env.DB.prepare(
        `DELETE FROM ${table} WHERE user_id IN (
           SELECT id FROM users WHERE id LIKE 'usr_bulk_%' ORDER BY id LIMIT ${DELETED})`,
      ).run();
      // An index scan per trigger would read at least DELETED x MEMBERS
      // (15,000) rows; a point lookup reads a small constant per row.
      expect(
        result.meta.rows_read,
        `deleting from ${table} scanned its search index once per row — ` +
          `see the key-table section of 0081`,
      ).toBeLessThan(DELETED * 30);
    }
    await expectIndexesConsistent();
  });
});
