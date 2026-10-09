import { describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import {
  D1_MAX_BOUND_PARAMS,
  getDb,
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
