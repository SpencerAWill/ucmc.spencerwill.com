import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
import { emailFingerprint } from "#/server/conduct/email-fingerprint.server";
import {
  anyTerminated,
  blockedEmailsAmong,
  isBlockedEmail,
  isTerminated,
  possibleTerminatedNameMatches,
  standingFor,
} from "#/server/conduct/standing.server";
import { createTermination } from "#/test-support/factories/conduct";
import { createUser } from "#/test-support/factories/users";

type RecordInsert = typeof schema.conductRecords.$inferInsert;

beforeEach(async () => {
  const db = getDb();
  await db
    .delete(schema.conductRecords)
    .where(eq(schema.conductRecords.level, "termination"));
  await db.delete(schema.conductRecords);
  await db.delete(schema.conductBlockedEmails);
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

describe("anyTerminated", () => {
  it("answers for a list in one query, ignoring lifted terminations and lower levels", async () => {
    const terminated = await createUser();
    const suspended = await createUser();
    const clear = await createUser();
    const id = await terminate(terminated.id);
    await suspend(suspended.id, "2000-01-01", "2999-01-01");

    expect(await anyTerminated([])).toBe(false);
    expect(await anyTerminated([clear.id, suspended.id])).toBe(false);
    expect(await anyTerminated([clear.id, terminated.id])).toBe(true);

    await getDb()
      .update(schema.conductRecords)
      .set({ liftedAt: Temporal.Instant.from("2026-12-01T00:00:00Z") })
      .where(eq(schema.conductRecords.id, id));
    expect(await anyTerminated([terminated.id])).toBe(false);
  });
});

describe("isBlockedEmail", () => {
  async function block(recordId: string, ...emails: string[]) {
    await getDb()
      .insert(schema.conductBlockedEmails)
      .values(
        await Promise.all(
          emails.map(async (email) => ({
            recordId,
            emailHmac: await emailFingerprint(email),
          })),
        ),
      );
  }

  it("is false for an address nobody blocked", async () => {
    expect(await isBlockedEmail("nobody@example.com")).toBe(false);
  });

  it("blocks every fingerprinted address of an unlifted termination, normalized", async () => {
    const user = await createUser();
    const id = await terminate(user.id);
    await block(id, "one@example.com", "two@example.com");
    expect(await isBlockedEmail("one@example.com")).toBe(true);
    expect(await isBlockedEmail(" TWO@Example.com ")).toBe(true);
    expect(await isBlockedEmail("three@example.com")).toBe(false);
  });

  it("outlives the account while the termination stands", async () => {
    const user = await createUser();
    const id = await terminate(user.id);
    await block(id, "gone@example.com");
    await getDb().delete(schema.users).where(eq(schema.users.id, user.id));
    expect(await isBlockedEmail("gone@example.com")).toBe(true);
  });

  it("ignores rows left on a lifted termination, account purged or not", async () => {
    const user = await createUser();
    const id = await terminate(user.id, {
      liftedAt: Temporal.Instant.from("2026-12-01T00:00:00Z"),
    });
    await block(id, "lifted@example.com");
    expect(await isBlockedEmail("lifted@example.com")).toBe(false);
    await getDb().delete(schema.users).where(eq(schema.users.id, user.id));
    expect(await isBlockedEmail("lifted@example.com")).toBe(false);
  });

  it("never blocks on a record that is not a termination", async () => {
    const user = await createUser();
    const id = await suspend(user.id, "2026-11-01", "2030-01-01");
    await block(id, "suspended@example.com");
    expect(await isBlockedEmail("suspended@example.com")).toBe(false);
  });
});

describe("blockedEmailsAmong", () => {
  it("answers an empty list with an empty set", async () => {
    expect(await blockedEmailsAmong([])).toEqual(new Set());
  });

  it("returns the normalized blocked addresses of unlifted terminations only", async () => {
    await createTermination({ emails: ["live@example.com"] });
    await createTermination({
      emails: ["lifted@example.com"],
      liftedAt: Temporal.Instant.from("2026-12-01T00:00:00Z"),
    });
    const user = await createUser();
    const suspension = await suspend(user.id, "2026-11-01", "2030-01-01");
    await getDb()
      .insert(schema.conductBlockedEmails)
      .values({
        recordId: suspension,
        emailHmac: await emailFingerprint("suspended@example.com"),
      });

    expect(
      await blockedEmailsAmong([
        " LIVE@Example.com ",
        "lifted@example.com",
        "suspended@example.com",
        "other@example.com",
      ]),
    ).toEqual(new Set(["live@example.com"]));
  });
});

describe("possibleTerminatedNameMatches", () => {
  it("matches the snapshot ignoring case and whitespace, keyed by the input", async () => {
    const id = await createTermination({ subjectName: "  Alex Smith " });
    const result = await possibleTerminatedNameMatches([
      "alex smith ",
      "Someone Else",
    ]);
    expect([...result.keys()]).toEqual(["alex smith "]);
    expect(result.get("alex smith ")).toEqual([id]);
  });

  it("ignores lifted terminations", async () => {
    await createTermination({
      subjectName: "Alex Smith",
      liftedAt: Temporal.Instant.from("2026-12-01T00:00:00Z"),
    });
    expect((await possibleTerminatedNameMatches(["Alex Smith"])).size).toBe(0);
  });

  it("leaves out records about the excluded user", async () => {
    const user = await createUser();
    await createTermination({
      subjectName: "Alex Smith",
      subjectUserId: user.id,
    });
    expect(
      (await possibleTerminatedNameMatches(["Alex Smith"], user.id)).size,
    ).toBe(0);
    expect((await possibleTerminatedNameMatches(["Alex Smith"])).size).toBe(1);
  });

  it("answers an empty list with an empty map", async () => {
    expect((await possibleTerminatedNameMatches([])).size).toBe(0);
  });
});
