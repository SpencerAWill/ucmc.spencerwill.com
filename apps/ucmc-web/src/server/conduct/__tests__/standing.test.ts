import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
import { isTerminated, standingFor } from "#/server/conduct/standing.server";
import { createUser } from "#/test-support/factories/users";

type RecordInsert = typeof schema.conductRecords.$inferInsert;

beforeEach(async () => {
  const db = getDb();
  await db
    .delete(schema.conductRecords)
    .where(eq(schema.conductRecords.level, "termination"));
  await db.delete(schema.conductRecords);
  await db.delete(schema.userRoles);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

afterEach(() => {
  vi.useRealTimers();
});

function base(userId: string, level: RecordInsert["level"]): RecordInsert {
  const id = `crec_${crypto.randomUUID()}`;
  return {
    id,
    publicId: id,
    level,
    subjectUserId: userId,
    subjectNameSnapshot: "Test Member",
    memberStatement: "Statement",
  };
}

async function suspend(
  userId: string,
  startsOn: string,
  endsOn: string,
  overrides: Partial<RecordInsert> = {},
): Promise<string> {
  const row = {
    ...base(userId, "suspension"),
    startsOn: Temporal.PlainDate.from(startsOn),
    endsOn: Temporal.PlainDate.from(endsOn),
    ...overrides,
  };
  await getDb().insert(schema.conductRecords).values(row);
  return row.id;
}

async function terminate(
  userId: string,
  overrides: Partial<RecordInsert> = {},
): Promise<string> {
  const row: RecordInsert = {
    ...base(userId, "termination"),
    voteHeldOn: Temporal.PlainDate.from("2026-10-01"),
    votesFor: 5,
    votesAgainst: 1,
    votesAbstain: 0,
    committeeSize: 7,
    warningSkipped: true,
    ...overrides,
  };
  await getDb().insert(schema.conductRecords).values(row);
  return row.id;
}

const day = (s: string) => Temporal.PlainDate.from(s);

describe("standingFor", () => {
  it("is clear with no records", async () => {
    const user = await createUser();
    expect(await standingFor(user.id, day("2026-11-05"))).toEqual({
      terminated: false,
      suspendedUntil: null,
      activeRecordIds: [],
    });
  });

  it("treats both ends of a suspension as inclusive", async () => {
    const user = await createUser();
    const id = await suspend(user.id, "2026-11-01", "2026-11-10");
    for (const d of ["2026-11-01", "2026-11-10"]) {
      const s = await standingFor(user.id, day(d));
      expect(s.suspendedUntil?.toString()).toBe("2026-11-10");
      expect(s.activeRecordIds).toEqual([id]);
    }
    for (const d of ["2026-10-31", "2026-11-11"]) {
      const s = await standingFor(user.id, day(d));
      expect(s.suspendedUntil).toBeNull();
      expect(s.activeRecordIds).toEqual([]);
    }
  });

  it("reports the later end of overlapping suspensions", async () => {
    const user = await createUser();
    await suspend(user.id, "2026-11-01", "2026-11-10");
    await suspend(user.id, "2026-11-05", "2026-11-20");
    const s = await standingFor(user.id, day("2026-11-06"));
    expect(s.suspendedUntil?.toString()).toBe("2026-11-20");
    expect(s.activeRecordIds).toHaveLength(2);
  });

  it("ignores a lifted suspension", async () => {
    const user = await createUser();
    await suspend(user.id, "2026-11-01", "2026-11-10", {
      liftedAt: Temporal.Instant.from("2026-11-02T12:00:00Z"),
    });
    const s = await standingFor(user.id, day("2026-11-05"));
    expect(s.suspendedUntil).toBeNull();
  });

  it("terminates until the termination is lifted", async () => {
    const user = await createUser();
    const id = await terminate(user.id);
    const s = await standingFor(user.id, day("2030-01-01"));
    expect(s).toEqual({
      terminated: true,
      suspendedUntil: null,
      activeRecordIds: [id],
    });
    expect(await isTerminated(user.id)).toBe(true);

    await getDb()
      .update(schema.conductRecords)
      .set({ liftedAt: Temporal.Instant.from("2026-12-01T00:00:00Z") })
      .where(eq(schema.conductRecords.id, id));
    expect((await standingFor(user.id)).terminated).toBe(false);
    expect(await isTerminated(user.id)).toBe(false);
  });

  it("never lets a warning or note affect standing", async () => {
    const user = await createUser();
    await getDb()
      .insert(schema.conductRecords)
      .values([base(user.id, "warning"), base(user.id, "note")]);
    expect(await standingFor(user.id, day("2026-11-05"))).toEqual({
      terminated: false,
      suspendedUntil: null,
      activeRecordIds: [],
    });
  });

  it("does not leak other members' records", async () => {
    const user = await createUser();
    const other = await createUser();
    await terminate(other.id);
    expect((await standingFor(user.id)).terminated).toBe(false);
  });

  it("defaults today to the club-local date, not UTC", async () => {
    const user = await createUser();
    await suspend(user.id, "2026-11-01", "2026-11-10");
    // 03:30Z on 11-11 is 23:30 EST on 11-10.
    vi.useFakeTimers({ now: new Date("2026-11-11T03:30:00Z") });
    const s = await standingFor(user.id);
    expect(s.suspendedUntil?.toString()).toBe("2026-11-10");
  });
});
