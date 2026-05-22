import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

// ── mocks ──────────────────────────────────────────────────────────────

const cookieJar = new Map<string, string>();
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => cookieJar.get(name),
  setCookie: (name: string, value: string) => {
    cookieJar.set(name, value);
  },
  deleteCookie: (name: string) => {
    cookieJar.delete(name);
  },
  getRequestHeader: () => undefined,
}));

vi.mock("#/server/rate-limit.server", () => ({
  checkAuthRateLimitByIp: async () => true,
  checkAuthRateLimitByEmail: async () => true,
  checkUploadRateLimit: async () => true,
}));

const {
  createHistoricalOfficerAction,
  updateHistoricalOfficerAction,
  deleteHistoricalOfficerAction,
  deleteHistoricalOfficersByYearAction,
  createHonoraryMemberAction,
  updateHonoraryMemberAction,
  reorderHonoraryMembersAction,
  deleteHonoraryMemberAction,
} = await import("#/features/history/server/history-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(email: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status: "approved",
  });
  await attachPrimaryEmail(id, email);
  await db.insert(schema.profiles).values({
    userId: id,
    fullName: "Test User",
    preferredName: "Test",
    phone: "+15135551212",
    ucAffiliation: "student",
    updatedAt: new Date(),
  });
  return id;
}

async function assignRole(userId: string, roleId: string): Promise<void> {
  await getDb()
    .insert(schema.userRoles)
    .values({ userId, roleId })
    .onConflictDoNothing();
}

async function signInAs(userId: string): Promise<void> {
  cookieJar.clear();
  await openSession(userId);
}

async function signInAsAdmin(email = "admin@example.com"): Promise<string> {
  const userId = await seedUser(email);
  await assignRole(userId, "role_system_admin");
  await signInAs(userId);
  return userId;
}

async function signInAsMember(email = "member@example.com"): Promise<string> {
  const userId = await seedUser(email);
  await assignRole(userId, "role_member");
  await signInAs(userId);
  return userId;
}

const OFFICER = {
  schoolYear: "2024-25",
  startYear: 2024,
  role: "President",
  roleOrder: 1,
  name: "Pat Example",
  notes: null,
};

const HONORARY = {
  name: "Jane Honor",
  sortOrder: 10,
  notes: null,
};

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.historicalOfficers);
  await db.delete(schema.honoraryMembers);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.userEmails);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

// ── historical officers ────────────────────────────────────────────────

describe("createHistoricalOfficerAction", () => {
  it("rejects callers without history:manage", async () => {
    await signInAsMember();
    await expect(createHistoricalOfficerAction(OFFICER)).rejects.toThrow(
      /history:manage/,
    );
  });

  it("inserts the row and emits an audit event", async () => {
    const actorId = await signInAsAdmin();
    const { id } = await createHistoricalOfficerAction(OFFICER);

    const [row] = await getDb()
      .select()
      .from(schema.historicalOfficers)
      .where(eq(schema.historicalOfficers.id, id));
    expect(row.role).toBe("President");
    expect(row.schoolYear).toBe("2024-25");

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "historical_officer.created"));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorUserId).toBe(actorId);
    expect(auditRows[0].targetId).toBe(String(id));
  });
});

describe("updateHistoricalOfficerAction", () => {
  it("rejects callers without history:manage", async () => {
    await signInAsAdmin();
    const { id } = await createHistoricalOfficerAction(OFFICER);
    await signInAsMember();
    await expect(
      updateHistoricalOfficerAction({
        id,
        ...OFFICER,
        name: "Renamed",
      }),
    ).rejects.toThrow(/history:manage/);
  });

  it("updates fields and emits an audit event", async () => {
    const actorId = await signInAsAdmin();
    const { id } = await createHistoricalOfficerAction(OFFICER);

    await updateHistoricalOfficerAction({
      id,
      ...OFFICER,
      name: "Updated Name",
    });

    const [row] = await getDb()
      .select()
      .from(schema.historicalOfficers)
      .where(eq(schema.historicalOfficers.id, id));
    expect(row.name).toBe("Updated Name");

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, "historical_officer.updated"),
          eq(schema.auditLog.targetId, String(id)),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorUserId).toBe(actorId);
  });
});

describe("deleteHistoricalOfficerAction", () => {
  it("rejects callers without history:manage", async () => {
    await signInAsAdmin();
    const { id } = await createHistoricalOfficerAction(OFFICER);
    await signInAsMember();
    await expect(deleteHistoricalOfficerAction({ id })).rejects.toThrow(
      /history:manage/,
    );
  });

  it("removes the row and emits an audit event", async () => {
    await signInAsAdmin();
    const { id } = await createHistoricalOfficerAction(OFFICER);

    await deleteHistoricalOfficerAction({ id });

    const remaining = await getDb()
      .select()
      .from(schema.historicalOfficers)
      .where(eq(schema.historicalOfficers.id, id));
    expect(remaining).toHaveLength(0);

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, "historical_officer.deleted"),
          eq(schema.auditLog.targetId, String(id)),
        ),
      );
    expect(auditRows).toHaveLength(1);
  });
});

describe("deleteHistoricalOfficersByYearAction", () => {
  it("rejects callers without history:manage", async () => {
    await signInAsMember();
    await expect(
      deleteHistoricalOfficersByYearAction({ startYear: 2024 }),
    ).rejects.toThrow(/history:manage/);
  });

  it("deletes every row for the year and emits one audit event", async () => {
    const actorId = await signInAsAdmin();
    await createHistoricalOfficerAction(OFFICER);
    await createHistoricalOfficerAction({
      ...OFFICER,
      role: "Vice President",
      roleOrder: 2,
      name: "Sam Two",
    });
    // A row for a different year — must NOT be deleted.
    await createHistoricalOfficerAction({
      ...OFFICER,
      schoolYear: "2023-24",
      startYear: 2023,
    });

    const result = await deleteHistoricalOfficersByYearAction({
      startYear: 2024,
    });
    expect(result.deletedCount).toBe(2);
    expect(result.schoolYear).toBe("2024-25");

    const remaining = await getDb().select().from(schema.historicalOfficers);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].startYear).toBe(2023);

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "historical_officer.year_deleted"));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorUserId).toBe(actorId);
    expect(auditRows[0].targetId).toBe("2024");
    const meta = JSON.parse(auditRows[0].metadataJson ?? "{}") as Record<
      string,
      unknown
    >;
    expect(meta.deletedCount).toBe(2);
    expect(meta.schoolYear).toBe("2024-25");
  });
});

// ── honorary members ───────────────────────────────────────────────────

describe("createHonoraryMemberAction", () => {
  it("rejects callers without history:manage", async () => {
    await signInAsMember();
    await expect(createHonoraryMemberAction(HONORARY)).rejects.toThrow(
      /history:manage/,
    );
  });

  it("inserts the row and emits an audit event", async () => {
    const actorId = await signInAsAdmin();
    const { id } = await createHonoraryMemberAction(HONORARY);

    const [row] = await getDb()
      .select()
      .from(schema.honoraryMembers)
      .where(eq(schema.honoraryMembers.id, id));
    expect(row.name).toBe("Jane Honor");

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "honorary_member.created"));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorUserId).toBe(actorId);
    expect(auditRows[0].targetId).toBe(String(id));
  });
});

describe("updateHonoraryMemberAction", () => {
  it("rejects callers without history:manage", async () => {
    await signInAsAdmin();
    const { id } = await createHonoraryMemberAction(HONORARY);
    await signInAsMember();
    await expect(
      updateHonoraryMemberAction({ id, ...HONORARY, name: "Renamed" }),
    ).rejects.toThrow(/history:manage/);
  });

  it("updates fields and emits an audit event", async () => {
    await signInAsAdmin();
    const { id } = await createHonoraryMemberAction(HONORARY);
    await updateHonoraryMemberAction({
      id,
      ...HONORARY,
      name: "Updated Honor",
    });

    const [row] = await getDb()
      .select()
      .from(schema.honoraryMembers)
      .where(eq(schema.honoraryMembers.id, id));
    expect(row.name).toBe("Updated Honor");

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, "honorary_member.updated"),
          eq(schema.auditLog.targetId, String(id)),
        ),
      );
    expect(auditRows).toHaveLength(1);
  });
});

describe("deleteHonoraryMemberAction", () => {
  it("rejects callers without history:manage", async () => {
    await signInAsAdmin();
    const { id } = await createHonoraryMemberAction(HONORARY);
    await signInAsMember();
    await expect(deleteHonoraryMemberAction({ id })).rejects.toThrow(
      /history:manage/,
    );
  });

  it("removes the row and emits an audit event", async () => {
    await signInAsAdmin();
    const { id } = await createHonoraryMemberAction(HONORARY);

    await deleteHonoraryMemberAction({ id });
    const remaining = await getDb()
      .select()
      .from(schema.honoraryMembers)
      .where(eq(schema.honoraryMembers.id, id));
    expect(remaining).toHaveLength(0);

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, "honorary_member.deleted"),
          eq(schema.auditLog.targetId, String(id)),
        ),
      );
    expect(auditRows).toHaveLength(1);
  });
});

describe("reorderHonoraryMembersAction", () => {
  it("rejects callers without history:manage", async () => {
    await signInAsMember();
    await expect(
      reorderHonoraryMembersAction({ ids: [1, 2, 3] }),
    ).rejects.toThrow(/history:manage/);
  });

  it("rewrites sort_order densely (1..N) in the supplied order", async () => {
    const actorId = await signInAsAdmin();
    // Seed three rows with non-dense sort orders so the dense rewrite
    // is actually observable.
    const { id: a } = await createHonoraryMemberAction({
      name: "Alpha",
      sortOrder: 50,
      notes: null,
    });
    const { id: b } = await createHonoraryMemberAction({
      name: "Beta",
      sortOrder: 100,
      notes: null,
    });
    const { id: c } = await createHonoraryMemberAction({
      name: "Gamma",
      sortOrder: 200,
      notes: null,
    });

    // New display order: Gamma, Alpha, Beta.
    const result = await reorderHonoraryMembersAction({ ids: [c, a, b] });
    expect(result.count).toBe(3);

    const rows = await getDb()
      .select({
        id: schema.honoraryMembers.id,
        name: schema.honoraryMembers.name,
        sortOrder: schema.honoraryMembers.sortOrder,
      })
      .from(schema.honoraryMembers)
      .orderBy(asc(schema.honoraryMembers.sortOrder));
    expect(rows.map((r) => [r.name, r.sortOrder])).toEqual([
      ["Gamma", 1],
      ["Alpha", 2],
      ["Beta", 3],
    ]);

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "honorary_member.reordered"));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorUserId).toBe(actorId);
    const meta = JSON.parse(auditRows[0].metadataJson ?? "{}") as Record<
      string,
      unknown
    >;
    expect(meta.count).toBe(3);
  });
});
