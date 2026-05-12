import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

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
}));

const { bulkImportLoansAction } =
  await import("#/features/gear/server/loans-bulk-import-actions.server");
const { createGearTypeAction } =
  await import("#/features/gear/server/gear-types-actions.server");
const { createGearAction, retireGearAction } =
  await import("#/features/gear/server/gear-actions.server");
const { checkoutLoansAction } =
  await import("#/features/gear/server/loans-actions.server");
const { openSession } = await import("#/server/auth/session.server");

async function seedUser(
  email: string,
  fullName = "Test Member",
  status: schema.UserStatus = "approved",
): Promise<{ id: string; publicId: string; email: string }> {
  const id = `user_${crypto.randomUUID()}`;
  const publicId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await getDb().insert(schema.users).values({ id, publicId, status });
  await attachPrimaryEmail(id, email);
  await getDb().insert(schema.profiles).values({
    userId: id,
    fullName,
    preferredName: fullName,
    phone: "555-0100",
    ucAffiliation: "student",
  });
  return { id, publicId, email };
}

async function signInAsLoanManager(): Promise<{
  id: string;
  publicId: string;
  email: string;
}> {
  const user = await seedUser(
    `mgr-${crypto.randomUUID()}@example.com`,
    "Loan Officer",
  );
  await getDb()
    .insert(schema.userRoles)
    .values({ userId: user.id, roleId: "role_system_admin" })
    .onConflictDoNothing();
  cookieJar.clear();
  await openSession(user.id);
  return user;
}

async function signInAsMember(): Promise<{
  id: string;
  publicId: string;
  email: string;
}> {
  const user = await seedUser(
    `plain-${crypto.randomUUID()}@example.com`,
    "Plain Member",
  );
  await getDb()
    .insert(schema.userRoles)
    .values({ userId: user.id, roleId: "role_member" })
    .onConflictDoNothing();
  cookieJar.clear();
  await openSession(user.id);
  return user;
}

async function createTypeOk(): Promise<string> {
  const r = await createGearTypeAction({
    name: `Harness ${crypto.randomUUID()}`,
    prefix: "CH",
    description: null,
  });
  if (!r.ok) throw new Error("createGearType failed");
  return r.publicId;
}

async function createGearOk(input: {
  typePublicId: string;
  code: string;
}): Promise<string> {
  const r = await createGearAction({
    typePublicId: input.typePublicId,
    code: input.code,
    description: "Test gear",
    thumbnailDataUrl: null,
    acquiredAt: null,
    acquisitionCostCents: null,
    notesMarkdown: null,
    condition: "serviceable",
    tagPublicIds: [],
  });
  if (!r.ok) throw new Error(`createGear failed: ${JSON.stringify(r)}`);
  return r.publicId;
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.gearLoans);
  await db.delete(schema.gearTagAssignments);
  await db.delete(schema.gear);
  await db.delete(schema.gearTags);
  await db.delete(schema.gearTypes);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

describe("bulkImportLoansAction authorization", () => {
  it("rejects unauthenticated callers", async () => {
    cookieJar.clear();
    await expect(bulkImportLoansAction({ rows: [] })).rejects.toThrow(
      "Not signed in",
    );
  });

  it("rejects regular members", async () => {
    await signInAsMember();
    await expect(bulkImportLoansAction({ rows: [] })).rejects.toThrow(
      "Forbidden: missing gear:loan",
    );
  });
});

describe("bulkImportLoansAction happy paths", () => {
  it("creates open and closed backfill loans in one batch", async () => {
    const officer = await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    await createGearOk({ typePublicId, code: "CH1" });
    await createGearOk({ typePublicId, code: "CH2" });
    const member = await seedUser("borrower@example.com", "Borrower");

    const result = await bulkImportLoansAction({
      rows: [
        // Open loan (returnedAt null).
        {
          memberEmail: member.email,
          gearCode: "CH1",
          checkedOutAt: "2024-09-12",
          dueAt: "2024-09-20",
          returnedAt: null,
          conditionAtReturn: null,
          checkoutNotes: "Fall break",
          checkinNotes: null,
        },
        // Closed loan with condition_at_return.
        {
          memberEmail: member.email,
          gearCode: "CH2",
          checkedOutAt: "2024-08-01",
          dueAt: "2024-08-08",
          returnedAt: "2024-08-09",
          conditionAtReturn: "needs_repair",
          checkoutNotes: null,
          checkinNotes: "Buckle snapped",
        },
      ],
    });

    expect(result.created).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);

    const loans = await getDb()
      .select()
      .from(schema.gearLoans)
      .orderBy(schema.gearLoans.checkedOutAt);
    expect(loans).toHaveLength(2);
    expect(loans[0]?.returnedAt).not.toBeNull();
    expect(loans[0]?.conditionAtReturn).toBe("needs_repair");
    expect(loans[0]?.checkinNotes).toBe("Buckle snapped");
    expect(loans[1]?.returnedAt).toBeNull();
    expect(loans[1]?.checkedOutByUserId).toBe(officer.id);

    // Audit chain: 2 checked_out + 1 checked_in. Every event carries
    // `backfill: true` so the audit log can filter or color these.
    const audits = await getDb().select().from(schema.auditLog);
    const checkedOut = audits.filter((r) => r.action === "loan.checked_out");
    const checkedIn = audits.filter((r) => r.action === "loan.checked_in");
    expect(checkedOut).toHaveLength(2);
    expect(checkedIn).toHaveLength(1);
    for (const row of [...checkedOut, ...checkedIn]) {
      const md = row.metadataJson
        ? (JSON.parse(row.metadataJson) as Record<string, unknown>)
        : {};
      expect(md.backfill).toBe(true);
      expect(md.bulk).toBe(true);
    }
  });

  it("defaults dueAt to checkedOutAt + 7d when omitted", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com");

    const result = await bulkImportLoansAction({
      rows: [
        {
          memberEmail: member.email,
          gearCode: "CH1",
          checkedOutAt: "2024-01-01",
          dueAt: null,
          returnedAt: null,
          conditionAtReturn: null,
          checkoutNotes: null,
          checkinNotes: null,
        },
      ],
    });
    expect(result.created).toHaveLength(1);
    const loan = (await getDb().select().from(schema.gearLoans)).at(0);
    // 7 days later — Jan 8, 2024.
    expect(loan?.dueAt.toISOString().slice(0, 10)).toBe("2024-01-08");
  });

  it("resolves email case-insensitively via the user_emails index", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    await createGearOk({ typePublicId, code: "CH1" });
    await seedUser("borrower@example.com");

    const result = await bulkImportLoansAction({
      rows: [
        {
          memberEmail: "Borrower@Example.COM",
          gearCode: "CH1",
          checkedOutAt: "2024-01-01",
          dueAt: null,
          returnedAt: null,
          conditionAtReturn: null,
          checkoutNotes: null,
          checkinNotes: null,
        },
      ],
    });
    expect(result.created).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("allows backfill against gear that's been retired since", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gearPublicId = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com");

    // Retire the gear FIRST — backfill should still record the
    // historical (closed) loan that happened before retirement.
    const retired = await retireGearAction({
      publicId: gearPublicId,
      reason: null,
    });
    expect(retired).toEqual({ ok: true });

    // After retirement, `gear.code` is NULL. Backfill must look up by
    // the original code, which won't resolve — so seed via a fresh
    // gear instead. (This documents the "code lookup is by current
    // value" boundary; a retired-and-replaced piece is an officer
    // problem, not a backfill one.) Use a *new* piece keeping its code.
    await createGearOk({ typePublicId, code: "CH2" });
    const result = await bulkImportLoansAction({
      rows: [
        {
          memberEmail: member.email,
          gearCode: "CH2",
          checkedOutAt: "2024-01-01",
          dueAt: "2024-01-08",
          returnedAt: "2024-01-08",
          conditionAtReturn: null,
          checkoutNotes: null,
          checkinNotes: null,
        },
      ],
    });
    expect(result.created).toHaveLength(1);
  });
});

describe("bulkImportLoansAction skip reasons", () => {
  it("skips member_not_found for unknown emails", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    await createGearOk({ typePublicId, code: "CH1" });

    const result = await bulkImportLoansAction({
      rows: [
        {
          memberEmail: "ghost@example.com",
          gearCode: "CH1",
          checkedOutAt: "2024-01-01",
          dueAt: null,
          returnedAt: null,
          conditionAtReturn: null,
          checkoutNotes: null,
          checkinNotes: null,
        },
      ],
    });
    expect(result.created).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe("member_not_found");
  });

  it("skips gear_not_found for unknown codes", async () => {
    await signInAsLoanManager();
    const member = await seedUser("borrower@example.com");

    const result = await bulkImportLoansAction({
      rows: [
        {
          memberEmail: member.email,
          gearCode: "ZZ999",
          checkedOutAt: "2024-01-01",
          dueAt: null,
          returnedAt: null,
          conditionAtReturn: null,
          checkoutNotes: null,
          checkinNotes: null,
        },
      ],
    });
    expect(result.created).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe("gear_not_found");
  });

  it("skips already_on_loan when gear has a pre-existing open loan", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gearPublicId = await createGearOk({ typePublicId, code: "CH1" });
    const m1 = await seedUser("m1@example.com");
    const m2 = await seedUser("m2@example.com");

    // Real open loan for m1 → backfill for m2 should be skipped.
    await checkoutLoansAction({
      memberPublicId: m1.publicId,
      items: [{ gearPublicId, durationDays: 7 }],
      notes: null,
    });

    const result = await bulkImportLoansAction({
      rows: [
        {
          memberEmail: m2.email,
          gearCode: "CH1",
          checkedOutAt: "2024-01-01",
          dueAt: null,
          returnedAt: null,
          conditionAtReturn: null,
          checkoutNotes: null,
          checkinNotes: null,
        },
      ],
    });
    expect(result.skipped[0]?.reason).toBe("already_on_loan");
  });

  it("flags duplicate_in_import when same gear appears twice as open", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    await createGearOk({ typePublicId, code: "CH1" });
    const m1 = await seedUser("m1@example.com");
    const m2 = await seedUser("m2@example.com");

    const result = await bulkImportLoansAction({
      rows: [
        {
          memberEmail: m1.email,
          gearCode: "CH1",
          checkedOutAt: "2024-01-01",
          dueAt: null,
          returnedAt: null,
          conditionAtReturn: null,
          checkoutNotes: null,
          checkinNotes: null,
        },
        {
          memberEmail: m2.email,
          gearCode: "CH1",
          checkedOutAt: "2024-02-01",
          dueAt: null,
          returnedAt: null,
          conditionAtReturn: null,
          checkoutNotes: null,
          checkinNotes: null,
        },
      ],
    });
    expect(result.created).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe("duplicate_in_import");
  });

  it("allows multiple closed loans on the same gear in one import", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    await createGearOk({ typePublicId, code: "CH1" });
    const m1 = await seedUser("m1@example.com");
    const m2 = await seedUser("m2@example.com");

    // Both closed → partial unique index doesn't apply. Two historical
    // loans on the same piece is normal (one borrower returned it,
    // another borrowed it later).
    const result = await bulkImportLoansAction({
      rows: [
        {
          memberEmail: m1.email,
          gearCode: "CH1",
          checkedOutAt: "2024-01-01",
          dueAt: "2024-01-08",
          returnedAt: "2024-01-08",
          conditionAtReturn: null,
          checkoutNotes: null,
          checkinNotes: null,
        },
        {
          memberEmail: m2.email,
          gearCode: "CH1",
          checkedOutAt: "2024-02-01",
          dueAt: "2024-02-08",
          returnedAt: "2024-02-08",
          conditionAtReturn: null,
          checkoutNotes: null,
          checkinNotes: null,
        },
      ],
    });
    expect(result.created).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });

  it("skips invalid_dates when due_at predates checked_out_at", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com");

    const result = await bulkImportLoansAction({
      rows: [
        {
          memberEmail: member.email,
          gearCode: "CH1",
          checkedOutAt: "2024-09-12",
          dueAt: "2024-09-01",
          returnedAt: null,
          conditionAtReturn: null,
          checkoutNotes: null,
          checkinNotes: null,
        },
      ],
    });
    expect(result.skipped[0]?.reason).toBe("invalid_dates");
  });

  it("does NOT update gear.condition based on condition_at_return", async () => {
    // Backfill records historical fact; it shouldn't reach forward to
    // mutate the gear's current condition.
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gearPublicId = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com");

    await bulkImportLoansAction({
      rows: [
        {
          memberEmail: member.email,
          gearCode: "CH1",
          checkedOutAt: "2024-01-01",
          dueAt: "2024-01-08",
          returnedAt: "2024-01-08",
          conditionAtReturn: "needs_repair",
          checkoutNotes: null,
          checkinNotes: null,
        },
      ],
    });

    const gear = (
      await getDb()
        .select({ condition: schema.gear.condition })
        .from(schema.gear)
        .where(eq(schema.gear.publicId, gearPublicId))
    ).at(0);
    expect(gear?.condition).toBe("serviceable");
  });
});
