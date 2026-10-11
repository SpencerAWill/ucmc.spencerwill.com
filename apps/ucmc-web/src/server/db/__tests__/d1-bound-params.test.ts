import { describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";

import {
  D1_MAX_BOUND_PARAMS,
  getDb,
  inJsonArray,
  insertMany,
  insertStatements,
  notInJsonArray,
  rowsPerInsertStatement,
  runBatch,
  schema,
  selectInChunks,
} from "#/server/db";

/**
 * The ceiling this module is built on, pinned against real D1 rather than
 * asserted from documentation.
 *
 * `D1_MAX_BOUND_PARAMS` is not a tuning knob — it is a platform limit, and
 * the failure mode when it is wrong is a 500 on a page in production rather
 * than anything a type or a lint rule would catch. If Cloudflare ever raises
 * or lowers it, the expectation below is what says so.
 */

/** Every message on an error's cause chain, so a wrapped driver error is visible. */
function causeChain(err: unknown): string {
  const messages: string[] = [];
  const walk = (e: unknown): void => {
    if (e instanceof Error) {
      messages.push(e.message);
      walk(e.cause);
    }
  };
  walk(err);
  return messages.join(" | ");
}

/** Ids that cannot match a row — this measures binding, not results. */
function ids(count: number): string[] {
  return Array.from({ length: count }, (_unused, i) => `user_probe_${i}`);
}

function selectUsersIn(list: readonly string[]) {
  return getDb()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.id, [...list]));
}

describe("D1 bound-parameter ceiling", () => {
  it(`binds exactly ${D1_MAX_BOUND_PARAMS} parameters`, async () => {
    await expect(selectUsersIn(ids(D1_MAX_BOUND_PARAMS))).resolves.toEqual([]);
  });

  it("refuses one parameter more, which is why selectInChunks exists", async () => {
    // Drizzle wraps the driver error in a `Failed query: …` of its own, so the
    // D1 refusal is on the cause chain rather than the top-level message.
    // Asserting on the reason — not merely that something threw — is the point:
    // a query that failed for an unrelated reason would otherwise keep this
    // test green while the ceiling moved underneath it.
    await expect(selectUsersIn(ids(D1_MAX_BOUND_PARAMS + 1))).rejects.toSatisfy(
      (err: unknown) => /too many SQL variables/i.test(causeChain(err)),
      "rejects with D1's too-many-variables error",
    );
  });
});

describe("selectInChunks", () => {
  it("returns no rows and issues no query for an empty list", async () => {
    const calls: number[] = [];
    const rows = await selectInChunks<string, { id: string }>([], (chunk) => {
      calls.push(chunk.length);
      return selectUsersIn(chunk);
    });
    expect(rows).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("issues a single query when the list fits", async () => {
    const calls: number[] = [];
    await selectInChunks(ids(D1_MAX_BOUND_PARAMS), (chunk) => {
      calls.push(chunk.length);
      return selectUsersIn(chunk);
    });
    expect(calls).toEqual([D1_MAX_BOUND_PARAMS]);
  });

  it("splits a list D1 would reject, and asks for every id exactly once", async () => {
    const all = ids(D1_MAX_BOUND_PARAMS * 2 + 7);
    const asked: string[] = [];
    await expect(
      selectInChunks(all, (chunk) => {
        asked.push(...chunk);
        return selectUsersIn(chunk);
      }),
    ).resolves.toEqual([]);
    expect(asked).toEqual(all);
  });

  it("concatenates rows from every chunk", async () => {
    const db = getDb();
    const seeded = ids(D1_MAX_BOUND_PARAMS + 20).map(
      (_unused, i) => `user_chunk_${i}`,
    );
    for (const id of seeded) {
      await db.insert(schema.users).values({
        id,
        publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        status: "approved",
      });
    }

    const rows = await selectInChunks(seeded, (chunk) => selectUsersIn(chunk));
    expect(rows.map((r) => r.id).sort()).toEqual([...seeded].sort());
  });

  it("reserves room for parameters the same statement binds elsewhere", async () => {
    const reservedParams = 40;
    const sizes: number[] = [];
    await selectInChunks(
      ids(D1_MAX_BOUND_PARAMS),
      (chunk) => {
        sizes.push(chunk.length);
        return selectUsersIn(chunk);
      },
      { reservedParams },
    );
    // Without the reservation this would have been one chunk of 100 —
    // which, plus the 40 the caller binds, D1 would refuse.
    expect(sizes).toEqual([60, 40]);
    expect(Math.max(...sizes) + reservedParams).toBeLessThanOrEqual(
      D1_MAX_BOUND_PARAMS,
    );
  });

  it("refuses a reservation that leaves no room for ids", async () => {
    await expect(
      selectInChunks(ids(1), (chunk) => selectUsersIn(chunk), {
        reservedParams: D1_MAX_BOUND_PARAMS,
      }),
    ).rejects.toThrow(RangeError);
  });
});

async function seedUsers(count: number, prefix: string): Promise<string[]> {
  const seeded = Array.from(
    { length: count },
    (_unused, i) => `${prefix}_${i}`,
  );
  await insertMany(
    schema.users,
    seeded.map((id) => ({
      id,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: "approved" as const,
    })),
  );
  return seeded;
}

describe("inJsonArray", () => {
  it("binds any length as one parameter — 5000 values, far past the ceiling", async () => {
    const real = await seedUsers(3, "user_json");
    const list = [...ids(4997), ...real];

    const rows = await getDb()
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inJsonArray(schema.users.id, list));

    expect(rows.map((r) => r.id).sort()).toEqual([...real].sort());
  });

  it("matches nothing for an empty list", async () => {
    await seedUsers(2, "user_json_empty");
    const rows = await getDb()
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inJsonArray(schema.users.id, []));
    expect(rows).toEqual([]);
  });

  it("keeps integers integers, so a numeric column still matches", async () => {
    const rows = await getDb().all<{ n: number }>(
      sql`SELECT 7 AS n WHERE 7 IN (SELECT value FROM json_each(${JSON.stringify([3, 7])}))`,
    );
    expect(rows).toEqual([{ n: 7 }]);
  });
});

describe("notInJsonArray", () => {
  it("excludes the listed values and nothing else, at any length", async () => {
    const seeded = await seedUsers(4, "user_notin");
    const rows = await getDb()
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(notInJsonArray(schema.users.id, [...ids(500), seeded[0] ?? ""]));
    // Other tests in this file seed users too; only this test's rows
    // say anything about what was excluded.
    const mine = rows.map((r) => r.id).filter((id) => seeded.includes(id));
    expect(mine.sort()).toEqual(seeded.slice(1).sort());
  });
});

describe("insertMany / insertStatements", () => {
  it("sizes a statement by the table's column count", () => {
    // 7 columns: id, actor, action, targetUser, targetType, targetId,
    // metadata — the audit row that broke every 15-target bulk action.
    expect(rowsPerInsertStatement(schema.auditLog)).toBe(14);
    expect(rowsPerInsertStatement(schema.auditLog, 30)).toBe(10);
    // A loan has 18 columns and none default to a SQL expression, so 5
    // rows. Conservative on purpose: D1 actually took 7 of the desk's
    // checkout rows (and refused 8 — why an 8-piece checkout failed),
    // because Drizzle inlines `null` for an omitted column with no
    // default. Counting it anyway costs an extra statement, never a 500.
    expect(rowsPerInsertStatement(schema.gearLoans)).toBe(5);
    expect(() =>
      rowsPerInsertStatement(schema.auditLog, D1_MAX_BOUND_PARAMS),
    ).toThrow(RangeError);
  });

  it("counts a SQL-default column as bound once a row supplies it", () => {
    // `assigned_at` defaults to a SQL expression, which Drizzle inlines
    // only when the value is left out. The bulk tagger supplies it, and
    // counting it as inlined is exactly how that insert overflowed.
    const omitted = rowsPerInsertStatement(schema.gearTagAssignments);
    const supplied = rowsPerInsertStatement(schema.gearTagAssignments, 0, [
      {
        itemId: "i",
        tagId: "t",
        assignedAt: Temporal.Now.instant(),
        assignedBy: null,
      },
    ]);
    expect(supplied).toBe(25);
    expect(omitted).toBeGreaterThan(supplied);
  });

  it("writes 300 audit rows — 22 statements, one atomic batch", async () => {
    const rows = Array.from({ length: 300 }, (_unused, i) => ({
      id: `audit_probe_${i}`,
      actorUserId: null,
      action: "settings_updated" as const,
      targetUserId: null,
      targetType: null,
      targetId: `t${i}`,
      metadataJson: null,
    }));
    expect(insertStatements(schema.auditLog, rows)).toHaveLength(22);

    await insertMany(schema.auditLog, rows);

    const written = await getDb()
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(
        inJsonArray(
          schema.auditLog.id,
          rows.map((r) => r.id),
        ),
      );
    expect(written).toHaveLength(300);
  });

  it("rolls back every chunk when one fails", async () => {
    const good = Array.from({ length: 20 }, (_unused, i) => ({
      id: `audit_rollback_${i}`,
      actorUserId: null,
      action: "settings_updated" as const,
      targetUserId: null,
      targetType: null,
      targetId: null,
      metadataJson: null,
    }));
    // The last row repeats the first's primary key, so the second
    // statement fails after the first has run.
    const rows = [...good, { ...good[0], targetId: "dupe" }];

    await expect(insertMany(schema.auditLog, rows)).rejects.toThrow();

    const written = await getDb()
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(
        inJsonArray(
          schema.auditLog.id,
          good.map((r) => r.id),
        ),
      );
    expect(written).toEqual([]);
  });

  it("does nothing for no rows", async () => {
    await expect(insertMany(schema.auditLog, [])).resolves.toBeUndefined();
    await expect(runBatch([])).resolves.toBeUndefined();
  });
});
