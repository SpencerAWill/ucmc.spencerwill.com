import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb, schema } from "#/server/db";
import { createUser } from "#/test-support/factories/users";

type RecordInsert = typeof schema.conductRecords.$inferInsert;

beforeEach(async () => {
  const db = getDb();
  // Terminations first: their prior_warning_id SET NULL would trip the
  // "exactly one of prior warning / skipped" CHECK if the warning went first.
  await db
    .delete(schema.conductRecords)
    .where(eq(schema.conductRecords.level, "termination"));
  await db.delete(schema.conductRecords);
  await db.delete(schema.conductReports);
  await db.delete(schema.userRoles);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

function termination(
  subjectUserId: string | null,
  overrides: Partial<RecordInsert> = {},
): RecordInsert {
  const id = `crec_${crypto.randomUUID()}`;
  return {
    id,
    publicId: id,
    level: "termination",
    subjectUserId,
    subjectNameSnapshot: "Test Member",
    memberStatement: "Statement",
    voteHeldOn: Temporal.PlainDate.from("2026-10-01"),
    votesFor: 5,
    votesAgainst: 1,
    votesAbstain: 0,
    committeeSize: 7,
    warningSkipped: true,
    ...overrides,
  };
}

async function insertWarning(subjectUserId: string): Promise<string> {
  const id = `crec_${crypto.randomUUID()}`;
  await getDb().insert(schema.conductRecords).values({
    id,
    publicId: id,
    level: "warning",
    subjectUserId,
    subjectNameSnapshot: "Test Member",
    memberStatement: "Statement",
  });
  return id;
}

describe("conduct_records constraints", () => {
  it("requires two thirds of the committee for a termination", async () => {
    const user = await createUser();
    const db = getDb();
    await expect(
      db
        .insert(schema.conductRecords)
        .values(termination(user.id, { votesFor: 4 })),
    ).rejects.toThrow();
    await expect(
      db
        .insert(schema.conductRecords)
        .values(termination(user.id, { votesFor: 5 })),
    ).resolves.toBeDefined();
  });

  it("rejects more votes than committee seats", async () => {
    const user = await createUser();
    await expect(
      getDb()
        .insert(schema.conductRecords)
        .values(termination(user.id, { votesFor: 6, votesAgainst: 2 })),
    ).rejects.toThrow();
  });

  it("needs exactly one of a prior warning or a skipped warning", async () => {
    const user = await createUser();
    const db = getDb();
    const warningId = await insertWarning(user.id);
    await expect(
      db.insert(schema.conductRecords).values(
        termination(user.id, {
          priorWarningId: warningId,
          warningSkipped: true,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.conductRecords).values(
        termination(user.id, {
          priorWarningId: null,
          warningSkipped: false,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.conductRecords).values(
        termination(user.id, {
          priorWarningId: warningId,
          warningSkipped: false,
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects a suspension without an end date", async () => {
    const user = await createUser();
    const id = `crec_${crypto.randomUUID()}`;
    await expect(
      getDb()
        .insert(schema.conductRecords)
        .values({
          id,
          publicId: id,
          level: "suspension",
          subjectUserId: user.id,
          subjectNameSnapshot: "Test Member",
          memberStatement: "Statement",
          startsOn: Temporal.PlainDate.from("2026-10-01"),
        }),
    ).rejects.toThrow();
  });

  it("keeps the row and nulls the subject when the user is deleted", async () => {
    const user = await createUser();
    const db = getDb();
    const warningId = await insertWarning(user.id);
    await db.delete(schema.profiles).where(eq(schema.profiles.userId, user.id));
    await db.delete(schema.users).where(eq(schema.users.id, user.id));
    const [row] = await db
      .select()
      .from(schema.conductRecords)
      .where(eq(schema.conductRecords.id, warningId));
    expect(row.subjectUserId).toBeNull();
    expect(row.subjectNameSnapshot).toBe("Test Member");
  });
});

describe("conduct_records constraints, continued", () => {
  it("rejects a termination with NULL vote columns", async () => {
    const user = await createUser();
    const db = getDb();
    await expect(
      db
        .insert(schema.conductRecords)
        .values(termination(user.id, { votesFor: null })),
    ).rejects.toThrow();
    await expect(
      db
        .insert(schema.conductRecords)
        .values(termination(user.id, { committeeSize: null })),
    ).rejects.toThrow();
  });

  it("refuses to delete a warning a termination cites", async () => {
    const user = await createUser();
    const db = getDb();
    const warningId = await insertWarning(user.id);
    const row = termination(user.id, {
      priorWarningId: warningId,
      warningSkipped: false,
    });
    await db.insert(schema.conductRecords).values(row);
    await expect(
      db
        .delete(schema.conductRecords)
        .where(eq(schema.conductRecords.id, warningId)),
    ).rejects.toThrow();
    const [kept] = await db
      .select()
      .from(schema.conductRecords)
      .where(eq(schema.conductRecords.id, row.id));
    expect(kept.priorWarningId).toBe(warningId);
  });

  it("requires a member statement above a note", async () => {
    const user = await createUser();
    const id = `crec_${crypto.randomUUID()}`;
    await expect(
      getDb().insert(schema.conductRecords).values({
        id,
        publicId: id,
        level: "warning",
        subjectUserId: user.id,
        subjectNameSnapshot: "Test Member",
      }),
    ).rejects.toThrow();
  });

  it("allows ends_on only on a warning or suspension", async () => {
    const user = await createUser();
    const db = getDb();
    const endsOn = Temporal.PlainDate.from("2026-12-01");
    const base = (level: "note" | "warning") => {
      const id = `crec_${crypto.randomUUID()}`;
      return {
        id,
        publicId: id,
        level,
        subjectUserId: user.id,
        subjectNameSnapshot: "Test Member",
        memberStatement: "Statement",
        endsOn,
      } as const;
    };
    await expect(
      db.insert(schema.conductRecords).values(base("note")),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.conductRecords).values(termination(user.id, { endsOn })),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.conductRecords).values(base("warning")),
    ).resolves.toBeDefined();
  });
});

describe("conduct_reports constraints", () => {
  it("needs a subject user or a description", async () => {
    const reporter = await createUser();
    const db = getDb();
    const row = (extra: Partial<typeof schema.conductReports.$inferInsert>) => {
      const id = `crep_${crypto.randomUUID()}`;
      return {
        id,
        publicId: id,
        reporterUserId: reporter.id,
        occurredOn: Temporal.PlainDate.from("2026-10-01"),
        body: "What happened",
        ...extra,
      };
    };
    await expect(
      db.insert(schema.conductReports).values(row({})),
    ).rejects.toThrow();
    await expect(
      db
        .insert(schema.conductReports)
        .values(row({ subjectDescription: "Tall person in a red jacket" })),
    ).resolves.toBeDefined();
    await db.delete(schema.conductReports);
  });
});

describe("conduct permission seed", () => {
  it("grants conduct:report to role_member and not conduct:view", async () => {
    const rows = await getDb()
      .select({ name: schema.permissions.name })
      .from(schema.rolePermissions)
      .innerJoin(
        schema.permissions,
        eq(schema.permissions.id, schema.rolePermissions.permissionId),
      )
      .where(eq(schema.rolePermissions.roleId, "role_member"));
    const names = rows.map((r) => r.name);
    expect(names).toContain("conduct:report");
    expect(names).not.toContain("conduct:view");
  });

  it("grants view to the three seeded exec roles and manage to the president", async () => {
    const db = getDb();
    const holders = async (name: string) =>
      (
        await db
          .select({ roleId: schema.rolePermissions.roleId })
          .from(schema.rolePermissions)
          .innerJoin(
            schema.permissions,
            and(eq(schema.permissions.id, schema.rolePermissions.permissionId)),
          )
          .where(eq(schema.permissions.name, name))
      )
        .map((r) => r.roleId)
        .sort();
    expect(await holders("conduct:view")).toEqual([
      "role_advisor",
      "role_president",
      "role_treasurer",
    ]);
    expect(await holders("conduct:manage")).toEqual(["role_president"]);
  });
});
