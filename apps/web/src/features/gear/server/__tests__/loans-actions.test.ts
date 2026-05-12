import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as LoansRepoModule from "#/features/gear/server/loans-repo.server";
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
}));

// Shared mutable flag used by the loans-repo mock below to suppress the
// pre-check inside `checkoutLoansAction` for the race-replay test only.
// `vi.hoisted` is required because `vi.mock` is hoisted above all module-
// scope statements; an ordinary `let` would still be in the TDZ when the
// mock factory runs.
const raceFlags = vi.hoisted(() => ({ skipPreCheck: false }));

vi.mock("#/features/gear/server/loans-repo.server", async (importOriginal) => {
  const actual = await importOriginal<typeof LoansRepoModule>();
  return {
    ...actual,
    getOpenLoanForGear: async (gearId: string) =>
      raceFlags.skipPreCheck ? null : actual.getOpenLoanForGear(gearId),
  };
});

const { createGearAction, retireGearAction } =
  await import("#/features/gear/server/gear-actions.server");
const { createGearTypeAction } =
  await import("#/features/gear/server/gear-types-actions.server");
const {
  checkinLoansAction,
  checkoutLoansAction,
  extendLoanAction,
  getLoanDetailAction,
  getMemberForLoanAction,
  listLoansAction,
  listMyLoansAction,
} = await import("#/features/gear/server/loans-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(
  email: string,
  fullName = "Test Member",
): Promise<{ id: string; publicId: string }> {
  const id = `user_${crypto.randomUUID()}`;
  const publicId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await getDb()
    .insert(schema.users)
    .values({ id, publicId, status: "approved" });
  await attachPrimaryEmail(id, email);
  await getDb().insert(schema.profiles).values({
    userId: id,
    fullName,
    preferredName: fullName,
    phone: "555-0100",
    ucAffiliation: "student",
  });
  return { id, publicId };
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

async function signInAsLoanManager(
  fullName = "Loan Officer",
): Promise<{ id: string; publicId: string }> {
  const user = await seedUser(
    `loan-mgr-${crypto.randomUUID()}@example.com`,
    fullName,
  );
  await assignRole(user.id, "role_system_admin");
  await signInAs(user.id);
  return user;
}

async function signInAsMember(
  fullName = "Plain Member",
): Promise<{ id: string; publicId: string }> {
  const user = await seedUser(
    `plain-${crypto.randomUUID()}@example.com`,
    fullName,
  );
  await assignRole(user.id, "role_member");
  await signInAs(user.id);
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
  code: string | null;
  condition?: schema.GearCondition;
}): Promise<string> {
  const r = await createGearAction({
    typePublicId: input.typePublicId,
    code: input.code,
    description: "Test gear",
    thumbnailDataUrl: null,
    acquiredAt: null,
    acquisitionCostCents: null,
    notesMarkdown: null,
    condition: input.condition ?? "serviceable",
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

// ── authorization ──────────────────────────────────────────────────────

describe("loans-actions authorization", () => {
  it("rejects unauthenticated callers from every officer action", async () => {
    cookieJar.clear();
    await expect(
      checkoutLoansAction({ memberPublicId: "x", items: [], notes: null }),
    ).rejects.toThrow("Not signed in");
    await expect(checkinLoansAction({ items: [] })).rejects.toThrow(
      "Not signed in",
    );
    await expect(
      extendLoanAction({ publicId: "x", newDueAt: Date.now() + 86400_000 }),
    ).rejects.toThrow("Not signed in");
    await expect(listLoansAction({})).rejects.toThrow("Not signed in");
  });

  it("rejects regular members from officer actions but allows /my/gear", async () => {
    await signInAsMember();
    await expect(
      checkoutLoansAction({ memberPublicId: "x", items: [], notes: null }),
    ).rejects.toThrow("Forbidden: missing gear:loan");
    await expect(checkinLoansAction({ items: [] })).rejects.toThrow(
      "Forbidden: missing gear:loan",
    );
    await expect(listLoansAction({})).rejects.toThrow(
      "Forbidden: missing gear:loan",
    );
    // /my/gear is a member-self read, only needs gear:read.
    const mine = await listMyLoansAction();
    expect(mine.active).toEqual([]);
    expect(mine.history).toEqual([]);
  });
});

// ── checkout ───────────────────────────────────────────────────────────

describe("checkoutLoansAction", () => {
  it("happy path: N items → N loans + N audit events with bulk:true", async () => {
    const officer = await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });
    const b = await createGearOk({ typePublicId, code: "CH2" });
    const c = await createGearOk({ typePublicId, code: "CH3" });
    const member = await seedUser("borrower@example.com", "Borrower One");

    const result = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [
        { gearPublicId: a, durationDays: 7 },
        { gearPublicId: b, durationDays: 3 },
        { gearPublicId: c, durationDays: 14 },
      ],
      notes: "weekend trip",
    });
    expect(result.results.filter((r) => r.ok)).toHaveLength(3);

    const loans = await getDb().select().from(schema.gearLoans);
    expect(loans).toHaveLength(3);
    expect(loans.every((l) => l.memberUserId === member.id)).toBe(true);
    expect(loans.every((l) => l.checkedOutByUserId === officer.id)).toBe(true);

    const audits = (await getDb().select().from(schema.auditLog)).filter(
      (r) => r.action === "loan.checked_out",
    );
    expect(audits).toHaveLength(3);
    for (const row of audits) {
      const md = row.metadataJson
        ? (JSON.parse(row.metadataJson) as Record<string, unknown>)
        : {};
      expect(md.bulk).toBe(true);
      expect(md.memberUserId).toBe(member.id);
    }
  });

  it("per-row skip reasons: not_found, retired, not_serviceable, already_on_loan", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const ok = await createGearOk({ typePublicId, code: "CH1" });
    const retired = await createGearOk({ typePublicId, code: "CH2" });
    await retireGearAction({ publicId: retired, reason: null });
    const damaged = await createGearOk({
      typePublicId,
      code: "CH3",
      condition: "needs_repair",
    });
    const onLoan = await createGearOk({ typePublicId, code: "CH4" });
    const member = await seedUser("borrower@example.com");
    // Pre-loan CH4 to a different borrower.
    const other = await seedUser("other@example.com");
    await checkoutLoansAction({
      memberPublicId: other.publicId,
      items: [{ gearPublicId: onLoan, durationDays: 7 }],
      notes: null,
    });

    const result = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [
        { gearPublicId: ok, durationDays: 7 },
        { gearPublicId: "missing-public-id", durationDays: 7 },
        { gearPublicId: retired, durationDays: 7 },
        { gearPublicId: damaged, durationDays: 7 },
        { gearPublicId: onLoan, durationDays: 7 },
      ],
      notes: null,
    });

    const skips = result.results.flatMap((r) => (r.ok ? [] : [r]));
    const reasonsByGear = Object.fromEntries(
      skips.map((s) => [s.gearPublicId, s.reason]),
    );
    expect(reasonsByGear["missing-public-id"]).toBe("not_found");
    expect(reasonsByGear[retired]).toBe("retired");
    expect(reasonsByGear[damaged]).toBe("not_serviceable");
    expect(reasonsByGear[onLoan]).toBe("already_on_loan");
    expect(result.results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("race replay: surfaces already_on_loan for the loser, lets survivors land", async () => {
    // Exercises the slow path inside checkoutLoansAction: pre-check
    // passes for every row, but the bulk insert trips the partial
    // unique index because a concurrent officer already opened a loan
    // on one of the pieces. The action catches the bulk failure and
    // replays row-by-row so winners still get loans.
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });
    const b = await createGearOk({ typePublicId, code: "CH2" });
    const other = await seedUser("other@example.com");
    const member = await seedUser("borrower@example.com");

    // Real concurrent loan on A — the partial unique index will trip
    // when the racing checkout tries to insert a second open row.
    await checkoutLoansAction({
      memberPublicId: other.publicId,
      items: [{ gearPublicId: a, durationDays: 7 }],
      notes: null,
    });

    raceFlags.skipPreCheck = true;
    try {
      const result = await checkoutLoansAction({
        memberPublicId: member.publicId,
        items: [
          { gearPublicId: a, durationDays: 7 },
          { gearPublicId: b, durationDays: 7 },
        ],
        notes: null,
      });
      const byGear = Object.fromEntries(
        result.results.map((r) => [r.gearPublicId, r] as const),
      );
      const aResult = byGear[a];
      const bResult = byGear[b];
      if (aResult.ok)
        throw new Error("expected A to fail with already_on_loan");
      expect(aResult.reason).toBe("already_on_loan");
      expect(bResult.ok).toBe(true);
    } finally {
      raceFlags.skipPreCheck = false;
    }

    // Survivors emit audit rows; the failing replay doesn't. One from
    // the seed loan on A + one from the replay survivor B = 2.
    const audits = (await getDb().select().from(schema.auditLog)).filter(
      (r) => r.action === "loan.checked_out",
    );
    expect(audits).toHaveLength(2);

    // And the DB ended up with two open loans, one per gear — not three.
    const openLoans = await getDb().select().from(schema.gearLoans);
    expect(openLoans).toHaveLength(2);
  });
});

// ── check-in ───────────────────────────────────────────────────────────

describe("checkinLoansAction", () => {
  it("closes a single loan and emits loan.checked_in", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com", "Test Borrower");
    await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });

    const result = await checkinLoansAction({
      items: [{ gearPublicId: gear, conditionAtReturn: null, notes: null }],
    });
    const ok = result.results.flatMap((r) => (r.ok ? [r] : []));
    expect(ok).toHaveLength(1);
    expect(ok[0]?.memberFullName).toBe("Test Borrower");

    const loans = await getDb().select().from(schema.gearLoans);
    expect(loans.at(0)?.returnedAt).not.toBeNull();
  });

  it("closes loans across multiple borrowers in one batch", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CH1" });
    const b = await createGearOk({ typePublicId, code: "CH2" });
    const m1 = await seedUser("m1@example.com", "Jane");
    const m2 = await seedUser("m2@example.com", "Bob");
    await checkoutLoansAction({
      memberPublicId: m1.publicId,
      items: [{ gearPublicId: a, durationDays: 7 }],
      notes: null,
    });
    await checkoutLoansAction({
      memberPublicId: m2.publicId,
      items: [{ gearPublicId: b, durationDays: 7 }],
      notes: null,
    });

    const result = await checkinLoansAction({
      items: [
        { gearPublicId: a, conditionAtReturn: null, notes: null },
        { gearPublicId: b, conditionAtReturn: null, notes: null },
      ],
    });
    const ok = result.results.flatMap((r) => (r.ok ? [r] : []));
    expect(ok).toHaveLength(2);
    const borrowers = ok.map((r) => r.memberFullName).sort();
    expect(borrowers).toEqual(["Bob", "Jane"]);
  });

  it("optional conditionAtReturn updates gear.condition and emits gear.updated", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com");
    await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });

    await checkinLoansAction({
      items: [
        {
          gearPublicId: gear,
          conditionAtReturn: "needs_repair",
          notes: "snapped buckle",
        },
      ],
    });

    const gRows = await getDb()
      .select({ condition: schema.gear.condition })
      .from(schema.gear)
      .where(eq(schema.gear.publicId, gear));
    expect(gRows.at(0)?.condition).toBe("needs_repair");
    const updates = (await getDb().select().from(schema.auditLog)).filter(
      (r) => r.action === "gear.updated",
    );
    expect(updates.length).toBeGreaterThan(0);
  });

  it("skips with no_open_loan when the gear isn't currently checked out", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });

    const result = await checkinLoansAction({
      items: [{ gearPublicId: gear, conditionAtReturn: null, notes: null }],
    });
    expect(result.results[0]).toEqual({
      ok: false,
      gearPublicId: gear,
      reason: "no_open_loan",
    });
  });
});

// ── extend ─────────────────────────────────────────────────────────────

describe("extendLoanAction", () => {
  it("happy path: emits loan.extended with priorDueAt/newDueAt", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com");
    const checkout = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });
    const loanPublicId = checkout.results
      .flatMap((r) => (r.ok ? [r.loanPublicId] : []))
      .at(0)!;

    const newDueAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const result = await extendLoanAction({ publicId: loanPublicId, newDueAt });
    expect(result.ok).toBe(true);

    const audits = (await getDb().select().from(schema.auditLog)).filter(
      (r) => r.action === "loan.extended",
    );
    expect(audits).toHaveLength(1);
  });

  it("rejects extension on a returned loan", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com");
    const checkout = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });
    const loanPublicId = checkout.results
      .flatMap((r) => (r.ok ? [r.loanPublicId] : []))
      .at(0)!;
    await checkinLoansAction({
      items: [{ gearPublicId: gear, conditionAtReturn: null, notes: null }],
    });

    const result = await extendLoanAction({
      publicId: loanPublicId,
      newDueAt: Date.now() + 86400_000,
    });
    expect(result).toEqual({ ok: false, reason: "loan_returned" });
  });

  it("rejects a due date in the past", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com");
    const checkout = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });
    const loanPublicId = checkout.results
      .flatMap((r) => (r.ok ? [r.loanPublicId] : []))
      .at(0)!;

    const result = await extendLoanAction({
      publicId: loanPublicId,
      newDueAt: Date.now() - 1000,
    });
    expect(result).toEqual({ ok: false, reason: "due_before_now" });
  });
});

// ── reads ──────────────────────────────────────────────────────────────

describe("listMyLoansAction", () => {
  it("returns only the principal's own loans", async () => {
    const officer = await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com", "Borrower");
    // Member needs gear:read to call /my/gear; role_member carries it.
    await assignRole(member.id, "role_member");
    await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });

    // Officer's own /my/gear should be empty (they ran the checkout
    // for someone else).
    const officerMine = await listMyLoansAction();
    expect(officerMine.active).toEqual([]);

    // Switch to the borrower and they see their loan.
    await signInAs(member.id);
    const memberMine = await listMyLoansAction();
    expect(memberMine.active).toHaveLength(1);
    expect(memberMine.history).toHaveLength(0);
    // Belt-and-suspenders: the officer's id shouldn't leak in.
    expect(memberMine.active[0]?.memberPublicId).toBe(member.publicId);
    expect(officer.id).not.toBe(member.id);
  });
});

describe("retireGearAction with open loan", () => {
  it("blocks retire with `on_loan` while a piece is checked out", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com");
    await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });

    const result = await retireGearAction({ publicId: gear, reason: null });
    expect(result).toEqual({ ok: false, reason: "on_loan" });
  });

  it("allows retire once the loan is closed", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com");
    await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });
    await checkinLoansAction({
      items: [{ gearPublicId: gear, conditionAtReturn: null, notes: null }],
    });

    const result = await retireGearAction({ publicId: gear, reason: null });
    expect(result).toEqual({ ok: true });
  });
});

describe("getLoanDetailAction", () => {
  it("returns officer + borrower display names", async () => {
    await signInAsLoanManager("Officer One");
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com", "Borrower One");
    const checkout = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });
    const loanPublicId = checkout.results
      .flatMap((r) => (r.ok ? [r.loanPublicId] : []))
      .at(0)!;

    const detail = await getLoanDetailAction({ publicId: loanPublicId });
    expect(detail.memberFullName).toBe("Borrower One");
    expect(detail.checkedOutByName).toBe("Officer One");
  });
});

describe("getMemberForLoanAction", () => {
  it("rejects unauthenticated callers", async () => {
    cookieJar.clear();
    await expect(getMemberForLoanAction({ publicId: "x" })).rejects.toThrow(
      "Not signed in",
    );
  });

  it("rejects regular members without gear:loan", async () => {
    await signInAsMember();
    await expect(getMemberForLoanAction({ publicId: "x" })).rejects.toThrow(
      "Forbidden: missing gear:loan",
    );
  });

  it("returns the approved member when called by an officer", async () => {
    await signInAsLoanManager();
    const member = await seedUser("borrower@example.com", "Jane Borrower");
    const found = await getMemberForLoanAction({ publicId: member.publicId });
    expect(found?.fullName).toBe("Jane Borrower");
    expect(found?.publicId).toBe(member.publicId);
  });

  it("returns null for an unknown publicId", async () => {
    await signInAsLoanManager();
    const found = await getMemberForLoanAction({
      publicId: "not-a-real-id",
    });
    expect(found).toBeNull();
  });
});
