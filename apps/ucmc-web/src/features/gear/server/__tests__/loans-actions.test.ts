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
    getOpenLoanForItem: async (itemId: string) =>
      raceFlags.skipPreCheck ? null : actual.getOpenLoanForItem(itemId),
  };
});

const { createGearAction, deactivateGearAction } =
  await import("#/features/gear/server/gear-actions.server");
const { createGearTypeAction } =
  await import("#/features/gear/server/gear-types-actions.server");
const {
  checkinLoansAction,
  checkoutLoansAction,
  extendLoanAction,
  getDeskModelAction,
  getLoanDefaultsAction,
  getLoanDetailAction,
  getMemberForLoanAction,
  listLoansAction,
  listMyLoansAction,
  listOpenCountedLoansForModelAction,
  searchCountedModelsForDeskAction,
  searchOpenCountedLoansAction,
  writeOffLoanShortfallAction,
} = await import("#/features/gear/server/loans-actions.server");
const { createGearModelAction, setGearModelStockAction } =
  await import("#/features/gear/server/models-actions.server");
const { placeGearHoldAction } =
  await import("#/features/gear/server/holds-actions.server");
const { insertCountedLoanIfAvailable, listLoans, recordCountedReturn } =
  await import("#/features/gear/server/loans-repo.server");
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

/**
 * A keeper holding `gear:loan` and NOT `gear:manage` — the delegable
 * desk tier. Ad-hoc role so the test pins the permission rather than a
 * seeded role's evolving grants.
 */
async function signInAsDeskKeeper(
  fullName = "Kit Keeper",
): Promise<{ id: string; publicId: string }> {
  const db = getDb();
  await db
    .insert(schema.roles)
    .values({
      id: "role_test_gear_keeper",
      name: "test_gear_keeper",
      displayName: "Test gear keeper",
    })
    .onConflictDoNothing();
  await db
    .insert(schema.rolePermissions)
    .values({ roleId: "role_test_gear_keeper", permissionId: "perm_gear_loan" })
    .onConflictDoNothing();
  const user = await seedUser(
    `keeper-${crypto.randomUUID()}@example.com`,
    fullName,
  );
  await assignRole(user.id, "role_member");
  await assignRole(user.id, "role_test_gear_keeper");
  await signInAs(user.id);
  return user;
}

async function createTypeOk(): Promise<string> {
  const r = await createGearTypeAction({
    name: `Harness ${crypto.randomUUID()}`,
    prefix: "CH",
    description: null,
    inspectionIntervalDays: null,
  });
  if (!r.ok) throw new Error("createGearType failed");
  return r.publicId;
}

/**
 * Creates the model on demand so a test can keep naming a type and get
 * a working item. The model layer is real in production — officers pick
 * a product — but a test asserting retire semantics shouldn't have to
 * care, so one model per type is created lazily and reused.
 */
const modelByType = new Map<string, string>();

async function modelForType(typePublicId: string): Promise<string> {
  const cached = modelByType.get(typePublicId);
  if (cached !== undefined) return cached;
  const result = await createGearModelAction({
    typePublicId,
    name: `Model for ${typePublicId}`,
    manufacturer: null,
    description: null,
    tracking: "coded",
    msrpCents: null,
    serviceLifeYears: null,
    manufacturedAtMs: null,
    inspectionIntervalDays: null,
    productUrl: null,
  });
  if (!result.ok) {
    throw new Error(`createGearModel failed: ${JSON.stringify(result)}`);
  }
  modelByType.set(typePublicId, result.publicId);
  return result.publicId;
}

async function createGearOk(input: {
  typePublicId: string;
  code: string | null;
  condition?: schema.GearCondition;
}): Promise<string> {
  const r = await createGearAction({
    modelPublicId: await modelForType(input.typePublicId),
    code: input.code,
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
  modelByType.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.siteSettings);
  await db.delete(schema.gearLoans);
  await db.delete(schema.gearTagAssignments);
  await db.delete(schema.gearHolds);
  await db.delete(schema.gearInventorySweepEntries);
  await db.delete(schema.gearInventorySweeps);
  await db.delete(schema.gearItemAttributeValues);
  await db.delete(schema.gearModelAttributeValues);
  await db.delete(schema.gearAttributeDefTypes);
  await db.delete(schema.gearAttributeDefs);
  await db.delete(schema.gearItems);
  await db.delete(schema.gearStockLevels);
  await db.delete(schema.gearModels);
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
        { kind: "coded", gearPublicId: a, durationDays: 7 },
        { kind: "coded", gearPublicId: b, durationDays: 3 },
        { kind: "coded", gearPublicId: c, durationDays: 14 },
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
    await deactivateGearAction({
      publicId: retired,
      status: "retired",
      reason: null,
    });
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
      items: [{ kind: "coded", gearPublicId: onLoan, durationDays: 7 }],
      notes: null,
    });

    const result = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [
        { kind: "coded", gearPublicId: ok, durationDays: 7 },
        { kind: "coded", gearPublicId: "missing-public-id", durationDays: 7 },
        { kind: "coded", gearPublicId: retired, durationDays: 7 },
        { kind: "coded", gearPublicId: damaged, durationDays: 7 },
        { kind: "coded", gearPublicId: onLoan, durationDays: 7 },
      ],
      notes: null,
    });

    const skips = result.results.flatMap((r) =>
      !r.ok && r.kind === "coded" ? [r] : [],
    );
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
      items: [{ kind: "coded", gearPublicId: a, durationDays: 7 }],
      notes: null,
    });

    raceFlags.skipPreCheck = true;
    try {
      const result = await checkoutLoansAction({
        memberPublicId: member.publicId,
        items: [
          { kind: "coded", gearPublicId: a, durationDays: 7 },
          { kind: "coded", gearPublicId: b, durationDays: 7 },
        ],
        notes: null,
      });
      const byGear = Object.fromEntries(
        result.results.flatMap((r) =>
          r.kind === "coded" ? [[r.gearPublicId, r] as const] : [],
        ),
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

// ── officer overrides ──────────────────────────────────────────────────

describe("checkoutLoansAction hold override", () => {
  /** Seeds a member, a held piece, and leaves the caller signed in as
   *  whoever `signIn` says. The hold itself needs `gear:manage`, so it
   *  is always placed by an admin first. */
  async function seedHeldPiece(): Promise<{
    gearPublicId: string;
    memberPublicId: string;
  }> {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gearPublicId = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com", "Borrower One");
    const now = Date.now();
    const hold = await placeGearHoldAction({
      gearPublicId,
      reason: "Held for the Red River trip",
      startsAtMs: now - 3600_000,
      endsAtMs: now + 86_400_000,
    });
    if (!hold.ok) throw new Error(`placeGearHold failed: ${hold.reason}`);
    return { gearPublicId, memberPublicId: member.publicId };
  }

  it("refuses a held piece when no override is passed", async () => {
    const { gearPublicId, memberPublicId } = await seedHeldPiece();

    const result = await checkoutLoansAction({
      memberPublicId,
      items: [{ kind: "coded", gearPublicId, durationDays: 7 }],
      notes: null,
    });

    expect(result.results).toEqual([
      { ok: false, kind: "coded", gearPublicId, reason: "on_hold" },
    ]);
  });

  it("lets a gear:manage officer override the hold, and records it", async () => {
    const { gearPublicId, memberPublicId } = await seedHeldPiece();

    const result = await checkoutLoansAction({
      memberPublicId,
      items: [{ kind: "coded", gearPublicId, durationDays: 7 }],
      notes: null,
      overrideHolds: true,
    });

    expect(result.results.every((r) => r.ok)).toBe(true);
    const audits = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "loan.checked_out"));
    expect(audits).toHaveLength(1);
    // The override is the judgement the officer made; it belongs on the
    // event, not only in the desk's memory.
    const metadataJson = audits.at(0)?.metadataJson;
    const md = metadataJson
      ? (JSON.parse(metadataJson) as Record<string, unknown>)
      : {};
    expect(md.overrideHolds).toBe(true);
    expect(md.overrideStanding).toBe(false);
  });

  it("ignores overrideHolds from a gear:loan keeper without gear:manage", async () => {
    const { gearPublicId, memberPublicId } = await seedHeldPiece();
    // `gear:loan` is delegable on its own, so the desk tier must not
    // inherit the override that comes with `gear:manage`.
    await signInAsDeskKeeper();

    const result = await checkoutLoansAction({
      memberPublicId,
      items: [{ kind: "coded", gearPublicId, durationDays: 7 }],
      notes: null,
      overrideHolds: true,
    });

    expect(result.results).toEqual([
      { ok: false, kind: "coded", gearPublicId, reason: "on_hold" },
    ]);
    const loans = await getDb().select().from(schema.gearLoans);
    expect(loans).toHaveLength(0);
  });
});

// ── check-in ───────────────────────────────────────────────────────────

// ── counted checkout ───────────────────────────────────────────────────

/**
 * A counted model with `serviceable` draws on the shelf. Created by the
 * signed-in caller, so call it as an admin.
 */
async function seedCountedModel(serviceable: number): Promise<{
  publicId: string;
  id: string;
}> {
  const typePublicId = await createTypeOk();
  const created = await createGearModelAction({
    typePublicId,
    name: `Draws ${crypto.randomUUID()}`,
    manufacturer: "BD",
    description: null,
    tracking: "counted",
    msrpCents: null,
    serviceLifeYears: null,
    manufacturedAtMs: null,
    inspectionIntervalDays: null,
    productUrl: null,
  });
  if (!created.ok)
    throw new Error(`createGearModel: ${JSON.stringify(created)}`);
  const stocked = await setGearModelStockAction({
    publicId: created.publicId,
    stock: [{ condition: "serviceable", quantity: serviceable }],
  });
  if (!stocked.ok) throw new Error(`setStock: ${JSON.stringify(stocked)}`);
  const row = (
    await getDb()
      .select({ id: schema.gearModels.id })
      .from(schema.gearModels)
      .where(eq(schema.gearModels.publicId, created.publicId))
  ).at(0);
  if (!row) throw new Error("model row missing");
  return { publicId: created.publicId, id: row.id };
}

function countedRow(modelPublicId: string, quantity: number) {
  return {
    kind: "counted" as const,
    modelPublicId,
    quantity,
    durationDays: 7,
  };
}

function auditMetadata(row: { metadataJson: string | null }) {
  return row.metadataJson
    ? (JSON.parse(row.metadataJson) as Record<string, unknown>)
    : {};
}

describe("checkoutLoansAction counted rows", () => {
  it("checks out a mixed batch — one harness and six draws", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const harness = await createGearOk({ typePublicId, code: "CH1" });
    const draws = await seedCountedModel(10);
    const member = await seedUser("mixed@example.com");

    const result = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [
        { kind: "coded", gearPublicId: harness, durationDays: 7 },
        countedRow(draws.publicId, 6),
      ],
      notes: null,
    });

    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.ok)).toBe(true);
    const countedLoan = (
      await getDb()
        .select()
        .from(schema.gearLoans)
        .where(eq(schema.gearLoans.modelId, draws.id))
    )[0];
    expect(countedLoan).toMatchObject({
      itemId: null,
      quantity: 6,
      quantityReturned: 0,
      returnedAt: null,
      reminderStage: "none",
    });
  });

  it("records level and quantity on loan.checked_out", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const harness = await createGearOk({ typePublicId, code: "CH1" });
    const draws = await seedCountedModel(10);
    const member = await seedUser("audit@example.com");

    await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [
        { kind: "coded", gearPublicId: harness, durationDays: 7 },
        countedRow(draws.publicId, 6),
      ],
      notes: null,
    });

    const audits = (await getDb().select().from(schema.auditLog)).filter(
      (r) => r.action === "loan.checked_out",
    );
    const levels = audits.map((a) => {
      const m = auditMetadata(a);
      return [m.level, m.quantity];
    });
    expect(levels).toEqual(
      expect.arrayContaining([
        ["item", 1],
        ["model", 6],
      ]),
    );
    const modelAudit = audits.find((a) => auditMetadata(a).level === "model");
    expect(modelAudit?.targetId).toBe(draws.id);
  });

  it("lends exactly up to the shelf and refuses one past it", async () => {
    await signInAsLoanManager();
    const draws = await seedCountedModel(10);
    const first = await seedUser("first@example.com");
    const second = await seedUser("second@example.com");

    const six = await checkoutLoansAction({
      memberPublicId: first.publicId,
      items: [countedRow(draws.publicId, 6)],
      notes: null,
    });
    expect(six.results[0]?.ok).toBe(true);

    // 4 left. Asking for 5 is one too many, and says how many there are.
    const five = await checkoutLoansAction({
      memberPublicId: second.publicId,
      items: [countedRow(draws.publicId, 5)],
      notes: null,
    });
    expect(five.results).toEqual([
      {
        ok: false,
        kind: "counted",
        modelPublicId: draws.publicId,
        reason: "insufficient_stock",
        available: 4,
      },
    ]);

    // Exactly the remainder goes out.
    const four = await checkoutLoansAction({
      memberPublicId: second.publicId,
      items: [countedRow(draws.publicId, 4)],
      notes: null,
    });
    expect(four.results[0]?.ok).toBe(true);

    const one = await checkoutLoansAction({
      memberPublicId: second.publicId,
      items: [countedRow(draws.publicId, 1)],
      notes: null,
    });
    expect(one.results[0]).toMatchObject({
      ok: false,
      reason: "insufficient_stock",
      available: 0,
    });
    const loans = await getDb()
      .select()
      .from(schema.gearLoans)
      .where(eq(schema.gearLoans.modelId, draws.id));
    expect(loans.reduce((sum, l) => sum + l.quantity, 0)).toBe(10);
  });

  it("guards the insert itself — two concurrent requests can't both take the last six", async () => {
    // Bypasses the action, whose availability read could otherwise mask
    // the race: this pins that the conditional insert is what holds.
    const admin = await signInAsLoanManager();
    const draws = await seedCountedModel(10);
    const member = await seedUser("race@example.com");
    const now = Temporal.Now.instant();
    const row = () => ({
      id: `gl_${crypto.randomUUID()}`,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      itemId: null,
      modelId: draws.id,
      quantity: 6,
      memberUserId: member.id,
      checkedOutByUserId: admin.id,
      checkedOutAt: now,
      dueAt: now.add({ hours: 24 * 7 }),
      checkoutNotes: null,
    });

    const outcomes = await Promise.all([
      insertCountedLoanIfAvailable(row(), { now, respectHolds: true }),
      insertCountedLoanIfAvailable(row(), { now, respectHolds: true }),
    ]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const loans = await getDb()
      .select()
      .from(schema.gearLoans)
      .where(eq(schema.gearLoans.modelId, draws.id));
    expect(loans).toHaveLength(1);
  });

  it("refuses a coded model as not_counted and an unknown one as not_found", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const codedModel = await modelForType(typePublicId);
    const member = await seedUser("wrongkind@example.com");

    const result = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [countedRow(codedModel, 2), countedRow("no-such-model", 2)],
      notes: null,
    });

    expect(
      result.results.map((r) => (r.ok ? "ok" : [r.kind, r.reason])),
    ).toEqual([
      ["counted", "not_counted"],
      ["counted", "not_found"],
    ]);
    expect(await getDb().select().from(schema.gearLoans)).toHaveLength(0);
  });

  it("refuses every row, counted included, for a blocked member", async () => {
    await signInAsLoanManager();
    const draws = await seedCountedModel(10);
    const member = await seedUser("blocked@example.com");
    const admin = await signInAsLoanManager("Backdater");
    // An open loan 30 days overdue blocks at the default 21.
    const longAgo = Temporal.Now.instant().subtract({ hours: 24 * 37 });
    await getDb()
      .insert(schema.gearLoans)
      .values({
        id: `gl_${crypto.randomUUID()}`,
        publicId: "overdue00001",
        modelId: draws.id,
        quantity: 1,
        memberUserId: member.id,
        checkedOutByUserId: admin.id,
        checkedOutAt: longAgo,
        dueAt: longAgo.add({ hours: 24 * 7 }),
      });

    const result = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [countedRow(draws.publicId, 2)],
      notes: null,
    });

    expect(result.results).toEqual([
      {
        ok: false,
        kind: "counted",
        modelPublicId: draws.publicId,
        reason: "member_blocked",
        available: null,
      },
    ]);
  });
});

describe("checkoutLoansAction counted rows under a hold", () => {
  /** Ten draws with six held for a trip, leaving four takeable. */
  async function seedHeldDraws(): Promise<{
    draws: { publicId: string; id: string };
    memberPublicId: string;
  }> {
    await signInAsLoanManager();
    const draws = await seedCountedModel(10);
    const now = Date.now();
    const hold = await placeGearHoldAction({
      modelPublicId: draws.publicId,
      quantity: 6,
      reason: "Held for the Red River trip",
      startsAtMs: now - 3600_000,
      endsAtMs: now + 86_400_000,
    });
    if (!hold.ok) throw new Error(`placeGearHold failed: ${hold.reason}`);
    const member = await seedUser("held-draws@example.com");
    return { draws, memberPublicId: member.publicId };
  }

  it("refuses past the held quantity as on_hold, naming what's left", async () => {
    const { draws, memberPublicId } = await seedHeldDraws();

    const result = await checkoutLoansAction({
      memberPublicId,
      items: [countedRow(draws.publicId, 5)],
      notes: null,
    });

    expect(result.results[0]).toMatchObject({
      ok: false,
      reason: "on_hold",
      available: 4,
    });
  });

  it("lends the unheld remainder without any override", async () => {
    const { draws, memberPublicId } = await seedHeldDraws();

    const result = await checkoutLoansAction({
      memberPublicId,
      items: [countedRow(draws.publicId, 4)],
      notes: null,
    });

    expect(result.results[0]?.ok).toBe(true);
  });

  it("lets a gear:manage officer override into the held units", async () => {
    const { draws, memberPublicId } = await seedHeldDraws();

    const result = await checkoutLoansAction({
      memberPublicId,
      items: [countedRow(draws.publicId, 8)],
      notes: null,
      overrideHolds: true,
    });

    expect(result.results[0]?.ok).toBe(true);
    const audit = (await getDb().select().from(schema.auditLog)).find(
      (r) => r.action === "loan.checked_out",
    );
    expect(audit && auditMetadata(audit).overrideHolds).toBe(true);
  });

  it("never overrides past the shelf itself", async () => {
    const { draws, memberPublicId } = await seedHeldDraws();

    const result = await checkoutLoansAction({
      memberPublicId,
      items: [countedRow(draws.publicId, 11)],
      notes: null,
      overrideHolds: true,
    });

    expect(result.results[0]).toMatchObject({
      ok: false,
      reason: "insufficient_stock",
      available: 10,
    });
  });

  it("ignores overrideHolds from a gear:loan keeper", async () => {
    const { draws, memberPublicId } = await seedHeldDraws();
    await signInAsDeskKeeper();

    const result = await checkoutLoansAction({
      memberPublicId,
      items: [countedRow(draws.publicId, 5)],
      notes: null,
      overrideHolds: true,
    });

    expect(result.results[0]).toMatchObject({ ok: false, reason: "on_hold" });
  });
});

describe("desk lookups for counted models", () => {
  it("searches counted models only, with takeable net of loans and holds", async () => {
    await signInAsLoanManager();
    const draws = await seedCountedModel(10);
    const typePublicId = await createTypeOk();
    await modelForType(typePublicId); // a coded model that must not appear
    const member = await seedUser("lookup@example.com");
    await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [countedRow(draws.publicId, 3)],
      notes: null,
    });
    const now = Date.now();
    await placeGearHoldAction({
      modelPublicId: draws.publicId,
      quantity: 2,
      reason: "Trip",
      startsAtMs: now - 1000,
      endsAtMs: now + 86_400_000,
    });

    const rows = await searchCountedModelsForDeskAction({ q: "Draws" });

    expect(rows).toEqual([
      expect.objectContaining({
        publicId: draws.publicId,
        takeable: 5,
        held: 2,
      }),
    ]);
  });

  it("resolves a bin label, and names a coded model rather than hiding it", async () => {
    await signInAsLoanManager();
    const draws = await seedCountedModel(4);
    const typePublicId = await createTypeOk();
    const coded = await modelForType(typePublicId);

    expect(await getDeskModelAction({ publicId: draws.publicId })).toEqual({
      ok: true,
      model: expect.objectContaining({ publicId: draws.publicId, takeable: 4 }),
    });
    expect(await getDeskModelAction({ publicId: coded })).toEqual({
      ok: false,
      reason: "not_counted",
    });
    expect(await getDeskModelAction({ publicId: "nope" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("requires gear:loan", async () => {
    await signInAsMember();
    await expect(
      searchCountedModelsForDeskAction({ q: "Draws" }),
    ).rejects.toThrow();
    await expect(getDeskModelAction({ publicId: "x" })).rejects.toThrow();
  });
});

// ── counted check-in ───────────────────────────────────────────────────

/** Lends `quantity` of a fresh counted model to a fresh member, as an
 *  admin, and returns everything a check-in test needs. */
async function seedCountedLoan(
  serviceable: number,
  quantity: number,
  memberName = "Draw Borrower",
): Promise<{
  draws: { publicId: string; id: string };
  member: { id: string; publicId: string };
  loanPublicId: string;
}> {
  await signInAsLoanManager();
  const draws = await seedCountedModel(serviceable);
  const member = await seedUser(
    `draws-${crypto.randomUUID()}@example.com`,
    memberName,
  );
  const checkout = await checkoutLoansAction({
    memberPublicId: member.publicId,
    items: [countedRow(draws.publicId, quantity)],
    notes: null,
  });
  const loan = checkout.results.at(0);
  if (!loan?.ok) throw new Error(`seed checkout: ${JSON.stringify(loan)}`);
  return { draws, member, loanPublicId: loan.loanPublicId };
}

function countedReturn(loanPublicId: string, quantity: number) {
  return { kind: "counted" as const, loanPublicId, quantity, notes: null };
}

async function loanRow(publicId: string) {
  const row = (
    await getDb()
      .select()
      .from(schema.gearLoans)
      .where(eq(schema.gearLoans.publicId, publicId))
  ).at(0);
  if (!row) throw new Error("loan row missing");
  return row;
}

describe("checkinLoansAction counted rows", () => {
  it("keeps a short return open, and closes it when the last unit lands", async () => {
    const { loanPublicId } = await seedCountedLoan(10, 6);

    const five = await checkinLoansAction({
      items: [countedReturn(loanPublicId, 5)],
    });
    expect(five.results[0]).toMatchObject({
      ok: true,
      kind: "counted",
      quantity: 5,
      outstanding: 1,
    });
    expect(await loanRow(loanPublicId)).toMatchObject({
      quantityReturned: 5,
      quantityLost: 0,
      returnedAt: null,
    });

    const last = await checkinLoansAction({
      items: [countedReturn(loanPublicId, 1)],
    });
    expect(last.results[0]).toMatchObject({ ok: true, outstanding: 0 });
    const closed = await loanRow(loanPublicId);
    expect(closed.quantityReturned).toBe(6);
    expect(closed.quantityLost).toBe(0);
    expect(closed.returnedAt).not.toBeNull();

    const closes = (await getDb().select().from(schema.auditLog))
      .filter((r) => r.action === "loan.checked_in")
      .map((r) => {
        const m = auditMetadata(r);
        return [m.level, m.quantityReturned, m.totalReturned, m.closed];
      });
    expect(closes).toEqual([
      ["model", 5, 5, false],
      ["model", 1, 6, true],
    ]);
  });

  it("releases returned units back to the shelf, and only those", async () => {
    const { draws, loanPublicId } = await seedCountedLoan(6, 6);
    await checkinLoansAction({ items: [countedReturn(loanPublicId, 2)] });
    const next = await seedUser("next@example.com");

    const three = await checkoutLoansAction({
      memberPublicId: next.publicId,
      items: [countedRow(draws.publicId, 3)],
      notes: null,
    });
    expect(three.results[0]).toMatchObject({
      ok: false,
      reason: "insufficient_stock",
      available: 2,
    });
    const two = await checkoutLoansAction({
      memberPublicId: next.publicId,
      items: [countedRow(draws.publicId, 2)],
      notes: null,
    });
    expect(two.results[0]?.ok).toBe(true);
  });

  it("refuses more than is still out, and changes nothing", async () => {
    const { loanPublicId } = await seedCountedLoan(10, 6);
    await checkinLoansAction({ items: [countedReturn(loanPublicId, 4)] });

    const result = await checkinLoansAction({
      items: [countedReturn(loanPublicId, 3)],
    });

    expect(result.results).toEqual([
      {
        ok: false,
        kind: "counted",
        loanPublicId,
        reason: "exceeds_outstanding",
        outstanding: 2,
      },
    ]);
    expect((await loanRow(loanPublicId)).quantityReturned).toBe(4);
  });

  it("guards the increment itself — two concurrent returns can't over-return", async () => {
    const { loanPublicId } = await seedCountedLoan(10, 6);
    const loan = await loanRow(loanPublicId);
    const admin = await signInAsLoanManager("Second desk");
    const now = Temporal.Now.instant();
    const ret = () =>
      recordCountedReturn({
        id: loan.id,
        units: 4,
        now,
        returnedToUserId: admin.id,
        checkinNotes: null,
      });

    const outcomes = await Promise.all([ret(), ret()]);

    expect(outcomes.filter((o) => o !== null)).toHaveLength(1);
    expect((await loanRow(loanPublicId)).quantityReturned).toBe(4);
  });

  it("refuses a coded loan as not_counted and a closed one as no_open_loan", async () => {
    const { loanPublicId } = await seedCountedLoan(10, 2);
    await checkinLoansAction({ items: [countedReturn(loanPublicId, 2)] });
    const typePublicId = await createTypeOk();
    const harness = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("coded@example.com");
    const coded = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ kind: "coded", gearPublicId: harness, durationDays: 7 }],
      notes: null,
    });
    const codedLoan = coded.results.at(0);
    if (!codedLoan?.ok) throw new Error("coded checkout failed");

    const result = await checkinLoansAction({
      items: [
        countedReturn(codedLoan.loanPublicId, 1),
        countedReturn(loanPublicId, 1),
        countedReturn("no-such-loan", 1),
      ],
    });

    expect(result.results.map((r) => (r.ok ? "ok" : r.reason))).toEqual([
      "not_counted",
      "no_open_loan",
      "not_found",
    ]);
  });

  it("checks in a coded piece and counted draws from different borrowers in one batch", async () => {
    const { loanPublicId } = await seedCountedLoan(10, 6, "Draw Holder");
    const typePublicId = await createTypeOk();
    const harness = await createGearOk({ typePublicId, code: "CH1" });
    const other = await seedUser("harness@example.com", "Harness Holder");
    await checkoutLoansAction({
      memberPublicId: other.publicId,
      items: [{ kind: "coded", gearPublicId: harness, durationDays: 7 }],
      notes: null,
    });

    const result = await checkinLoansAction({
      items: [
        {
          kind: "coded",
          gearPublicId: harness,
          conditionAtReturn: null,
          notes: null,
        },
        countedReturn(loanPublicId, 6),
      ],
    });

    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(
      result.results.flatMap((r) => (r.ok ? [r.memberFullName] : [])),
    ).toEqual(["Harness Holder", "Draw Holder"]);
  });

  it("lists open counted loans by model and by borrower name, outstanding net of returns", async () => {
    const { draws, loanPublicId } = await seedCountedLoan(10, 6, "Riley Draws");
    await checkinLoansAction({ items: [countedReturn(loanPublicId, 2)] });

    const byModel = await listOpenCountedLoansForModelAction({
      modelPublicId: draws.publicId,
    });
    const byName = await searchOpenCountedLoansAction({ q: "Riley" });

    for (const rows of [byModel, byName]) {
      expect(rows).toEqual([
        expect.objectContaining({
          loanPublicId,
          quantity: 6,
          outstanding: 4,
          memberFullName: "Riley Draws",
        }),
      ]);
    }
    await checkinLoansAction({ items: [countedReturn(loanPublicId, 4)] });
    expect(
      await listOpenCountedLoansForModelAction({
        modelPublicId: draws.publicId,
      }),
    ).toEqual([]);
  });
});

describe("writeOffLoanShortfallAction", () => {
  it("closes a short loan, writing what's still out into quantityLost", async () => {
    const { loanPublicId } = await seedCountedLoan(10, 6);
    await checkinLoansAction({ items: [countedReturn(loanPublicId, 5)] });

    const result = await writeOffLoanShortfallAction({
      publicId: loanPublicId,
      reason: "Dropped off the crag at Red River",
    });

    expect(result).toEqual({ ok: true, quantityLost: 1 });
    const row = await loanRow(loanPublicId);
    expect(row.quantityLost).toBe(1);
    expect(row.quantityReturned).toBe(5);
    expect(row.returnedAt).not.toBeNull();
    const audit = (await getDb().select().from(schema.auditLog)).find(
      (r) => r.action === "loan.written_off",
    );
    expect(audit && auditMetadata(audit)).toMatchObject({
      quantity: 6,
      quantityLost: 1,
      reason: "Dropped off the crag at Red River",
    });
  });

  it("takes the lost units off the shelf, so the desk can't lend them", async () => {
    const { draws, loanPublicId } = await seedCountedLoan(6, 6);
    await checkinLoansAction({ items: [countedReturn(loanPublicId, 5)] });

    await writeOffLoanShortfallAction({
      publicId: loanPublicId,
      reason: "Lost",
    });

    const [desk] = await searchCountedModelsForDeskAction({ q: "Draws" });
    expect(desk).toMatchObject({ publicId: draws.publicId, takeable: 5 });
    const stock = await getDb()
      .select()
      .from(schema.gearStockLevels)
      .where(eq(schema.gearStockLevels.modelId, draws.id));
    expect(stock.find((s) => s.condition === "serviceable")?.quantity).toBe(5);
  });

  it("writes off nothing twice — a second attempt leaves the shelf alone", async () => {
    const { draws, loanPublicId } = await seedCountedLoan(6, 6);
    await checkinLoansAction({ items: [countedReturn(loanPublicId, 4)] });
    await writeOffLoanShortfallAction({ publicId: loanPublicId, reason: "a" });

    const again = await writeOffLoanShortfallAction({
      publicId: loanPublicId,
      reason: "b",
    });

    expect(again).toEqual({ ok: false, reason: "loan_returned" });
    const stock = await getDb()
      .select()
      .from(schema.gearStockLevels)
      .where(eq(schema.gearStockLevels.modelId, draws.id));
    expect(stock.find((s) => s.condition === "serviceable")?.quantity).toBe(4);
  });

  it("is a gear:manage judgement — a desk keeper is refused", async () => {
    const { loanPublicId } = await seedCountedLoan(10, 6);
    await signInAsDeskKeeper();

    const result = await writeOffLoanShortfallAction({
      publicId: loanPublicId,
      reason: "Lost",
    });

    expect(result).toEqual({ ok: false, reason: "requires_manage" });
    expect((await loanRow(loanPublicId)).returnedAt).toBeNull();
  });

  it("refuses a coded loan and an already-closed one", async () => {
    const { loanPublicId } = await seedCountedLoan(10, 1);
    await checkinLoansAction({ items: [countedReturn(loanPublicId, 1)] });
    const typePublicId = await createTypeOk();
    const harness = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("lost-harness@example.com");
    const coded = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ kind: "coded", gearPublicId: harness, durationDays: 7 }],
      notes: null,
    });
    const codedLoan = coded.results.at(0);
    if (!codedLoan?.ok) throw new Error("coded checkout failed");

    expect(
      await writeOffLoanShortfallAction({
        publicId: codedLoan.loanPublicId,
        reason: "Lost",
      }),
    ).toEqual({ ok: false, reason: "not_counted" });
    expect(
      await writeOffLoanShortfallAction({
        publicId: loanPublicId,
        reason: "x",
      }),
    ).toEqual({ ok: false, reason: "loan_returned" });
  });
});

describe("checkinLoansAction", () => {
  it("closes a single loan and emits loan.checked_in", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com", "Test Borrower");
    await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ kind: "coded", gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });

    const result = await checkinLoansAction({
      items: [
        {
          kind: "coded",
          gearPublicId: gear,
          conditionAtReturn: null,
          notes: null,
        },
      ],
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
      items: [{ kind: "coded", gearPublicId: a, durationDays: 7 }],
      notes: null,
    });
    await checkoutLoansAction({
      memberPublicId: m2.publicId,
      items: [{ kind: "coded", gearPublicId: b, durationDays: 7 }],
      notes: null,
    });

    const result = await checkinLoansAction({
      items: [
        {
          kind: "coded",
          gearPublicId: a,
          conditionAtReturn: null,
          notes: null,
        },
        {
          kind: "coded",
          gearPublicId: b,
          conditionAtReturn: null,
          notes: null,
        },
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
      items: [{ kind: "coded", gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });

    await checkinLoansAction({
      items: [
        {
          kind: "coded",
          gearPublicId: gear,
          conditionAtReturn: "needs_repair",
          notes: "snapped buckle",
        },
      ],
    });

    const gRows = await getDb()
      .select({ condition: schema.gearItems.condition })
      .from(schema.gearItems)
      .where(eq(schema.gearItems.publicId, gear));
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
      items: [
        {
          kind: "coded",
          gearPublicId: gear,
          conditionAtReturn: null,
          notes: null,
        },
      ],
    });
    expect(result.results[0]).toEqual({
      ok: false,
      kind: "coded",
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
      items: [{ kind: "coded", gearPublicId: gear, durationDays: 7 }],
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
      items: [{ kind: "coded", gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });
    const loanPublicId = checkout.results
      .flatMap((r) => (r.ok ? [r.loanPublicId] : []))
      .at(0)!;
    await checkinLoansAction({
      items: [
        {
          kind: "coded",
          gearPublicId: gear,
          conditionAtReturn: null,
          notes: null,
        },
      ],
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
      items: [{ kind: "coded", gearPublicId: gear, durationDays: 7 }],
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

  // ── the overdue gate ─────────────────────────────────────────────────
  //
  // Standing is `daysOverdue(dueAt, now)`, so pushing a due date out
  // resets it — a ONE-DAY extension on a rope that is thirty days late
  // turns a blocked member back into a good one. That made "extend" the
  // silent escape hatch from the whole overdue apparatus.

  /** When the ladder last chased the seeded overdue loan. */
  const CHASED_AT = Temporal.Instant.fromEpochMilliseconds(1_770_000_000_000);

  /** A loan already past due, with the due date written directly. */
  async function overdueLoan(): Promise<{ publicId: string; id: string }> {
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH9" });
    const member = await seedUser(`late-${crypto.randomUUID()}@example.com`);
    const checkout = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ kind: "coded", gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });
    const publicId = checkout.results
      .flatMap((r) => (r.ok ? [r.loanPublicId] : []))
      .at(0)!;
    const rows = await getDb()
      .update(schema.gearLoans)
      .set({
        dueAt: Temporal.Now.instant().subtract({ hours: 24 * 30 }),
        reminderStage: "flagged",
        // Set so the "survives the extend" assertion below isn't
        // vacuously true against a column that was never written.
        lastRemindedAt: CHASED_AT,
      })
      .where(eq(schema.gearLoans.publicId, publicId))
      .returning({ id: schema.gearLoans.id });
    return { publicId, id: rows[0].id };
  }

  it("refuses a desk keeper extending an already-overdue loan", async () => {
    await signInAsLoanManager();
    const loan = await overdueLoan();
    // `gear:loan` without `gear:manage` — the delegable desk tier.
    await signInAsDeskKeeper();

    const result = await extendLoanAction({
      publicId: loan.publicId,
      newDueAt: Date.now() + 86400_000,
      // Passing the flag must not be enough; the action resolves it
      // against the real principal's permissions.
      overrideOverdue: true,
    });

    expect(result).toEqual({
      ok: false,
      reason: "overdue_requires_override",
    });
  });

  it("refuses even a gear:manage holder who doesn't ask for the override", async () => {
    await signInAsLoanManager();
    const loan = await overdueLoan();

    const result = await extendLoanAction({
      publicId: loan.publicId,
      newDueAt: Date.now() + 86400_000,
    });

    // Deliberate, not incidental: the override is a judgement an officer
    // makes on purpose, not something they fall into by clicking Save.
    expect(result).toEqual({
      ok: false,
      reason: "overdue_requires_override",
    });
  });

  it("allows the override with gear:manage and records it", async () => {
    await signInAsLoanManager();
    const loan = await overdueLoan();

    const result = await extendLoanAction({
      publicId: loan.publicId,
      newDueAt: Date.now() + 86400_000,
      overrideOverdue: true,
      overrideReason: "Away on a trip, back Monday",
    });
    expect(result.ok).toBe(true);

    const audit = (await getDb().select().from(schema.auditLog))
      .filter((r) => r.action === "loan.extended")
      .at(0);
    const metadata = JSON.parse(audit!.metadataJson ?? "{}") as Record<
      string,
      unknown
    >;
    expect(metadata.wasOverdue).toBe(true);
    expect(metadata.overrideOverdue).toBe(true);
    expect(metadata.overrideReason).toBe("Away on a trip, back Monday");
    // Where the ladder was before the reset, so an unexplained silence
    // afterwards is traceable.
    expect(metadata.priorReminderStage).toBe("flagged");
  });

  it("stays routine for a loan that is not yet due", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("ontime@example.com");
    const checkout = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ kind: "coded", gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });
    const loanPublicId = checkout.results
      .flatMap((r) => (r.ok ? [r.loanPublicId] : []))
      .at(0)!;
    // A desk keeper with no `gear:manage` at all.
    await signInAsDeskKeeper();

    const result = await extendLoanAction({
      publicId: loanPublicId,
      newDueAt: Date.now() + 14 * 86400_000,
    });

    expect(result.ok).toBe(true);
  });

  it("resets the reminder ladder so the new due date gets its own nudge", async () => {
    await signInAsLoanManager();
    const loan = await overdueLoan();

    await extendLoanAction({
      publicId: loan.publicId,
      newDueAt: Date.now() + 14 * 86400_000,
      overrideOverdue: true,
      overrideReason: "Trip",
    });

    const row = (
      await getDb()
        .select({
          stage: schema.gearLoans.reminderStage,
          lastRemindedAt: schema.gearLoans.lastRemindedAt,
        })
        .from(schema.gearLoans)
        .where(eq(schema.gearLoans.id, loan.id))
    ).at(0);

    // The ladder only climbs, so a loan left at `flagged` would stay
    // silent for its whole extension and then jump straight back to
    // `flagged` — the member would never hear about the date they were
    // actually given.
    expect(row?.stage).toBe("none");
    // Not cleared: when we last chased them is a historical fact, not
    // ladder state, and the loan detail page reads it.
    expect(row?.lastRemindedAt?.epochMilliseconds).toBe(
      CHASED_AT.epochMilliseconds,
    );
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
      items: [{ kind: "coded", gearPublicId: gear, durationDays: 7 }],
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

describe("deactivateGearAction with open loan", () => {
  it("blocks retire with `on_loan` while a piece is checked out", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com");
    await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ kind: "coded", gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });

    const result = await deactivateGearAction({
      publicId: gear,
      status: "retired",
      reason: null,
    });
    expect(result).toEqual({ ok: false, reason: "on_loan" });
  });

  it("allows retire once the loan is closed", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("borrower@example.com");
    await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ kind: "coded", gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });
    await checkinLoansAction({
      items: [
        {
          kind: "coded",
          gearPublicId: gear,
          conditionAtReturn: null,
          notes: null,
        },
      ],
    });

    const result = await deactivateGearAction({
      publicId: gear,
      status: "retired",
      reason: null,
    });
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
      items: [{ kind: "coded", gearPublicId: gear, durationDays: 7 }],
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

describe("listLoans search", () => {
  it("matches the borrower's primary email in free-text search", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const gear = await createGearOk({ typePublicId, code: "CH1" });
    const member = await seedUser("findme@example.com", "Search Target");
    await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [{ kind: "coded", gearPublicId: gear, durationDays: 7 }],
      notes: null,
    });

    const byFullEmail = await listLoans({ q: "findme@example.com" });
    expect(byFullEmail.rows).toHaveLength(1);
    expect(byFullEmail.total).toBe(1);

    // Substring also matches — the LIKE wraps the needle with %…%.
    const byLocalPart = await listLoans({ q: "findme" });
    expect(byLocalPart.rows).toHaveLength(1);

    const miss = await listLoans({ q: "nobody@nowhere.test" });
    expect(miss.rows).toHaveLength(0);
    expect(miss.total).toBe(0);
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

// ── sort direction ─────────────────────────────────────────────────────

describe("listLoansAction sort direction", () => {
  it("defaults due_at to soonest-first and honours an explicit flip", async () => {
    await signInAsLoanManager();
    const member = await seedUser(
      `borrower-${crypto.randomUUID()}@example.com`,
      "Borrower One",
    );
    const typeId = await createTypeOk();
    const dueSoon = await createGearOk({ typePublicId: typeId, code: "CH1" });
    const dueLater = await createGearOk({ typePublicId: typeId, code: "CH2" });

    const checkout = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: [
        { kind: "coded", gearPublicId: dueSoon, durationDays: 1 },
        { kind: "coded", gearPublicId: dueLater, durationDays: 30 },
      ],
      notes: null,
    });
    const loanFor = new Map(
      checkout.results.flatMap((r) =>
        r.ok && r.kind === "coded"
          ? [[r.gearPublicId, r.loanPublicId] as const]
          : [],
      ),
    );
    const soonLoan = loanFor.get(dueSoon);
    const laterLoan = loanFor.get(dueLater);
    expect(soonLoan).toBeDefined();
    expect(laterLoan).toBeDefined();

    const order = async (input: Parameters<typeof listLoansAction>[0]) =>
      (await listLoansAction(input)).rows.map((r) => r.publicId);

    // Omitting `dir` has to keep the pre-direction behaviour: due date
    // ascending, so the most overdue loan is the first thing an officer
    // sees. A uniform `asc`/`desc` default would have silently reversed
    // one of the two keys.
    expect(await order({ tab: "active" })).toEqual([soonLoan, laterLoan]);
    expect(await order({ tab: "active", sort: "due_at" })).toEqual([
      soonLoan,
      laterLoan,
    ]);
    expect(await order({ tab: "active", sort: "due_at", dir: "asc" })).toEqual([
      soonLoan,
      laterLoan,
    ]);
    expect(await order({ tab: "active", sort: "due_at", dir: "desc" })).toEqual(
      [laterLoan, soonLoan],
    );
  });
});

// ── desk prefill defaults ───────────────────────────────────────────────

describe("getLoanDefaultsAction", () => {
  async function setSetting(key: string, value: unknown): Promise<void> {
    await getDb()
      .insert(schema.siteSettings)
      .values({ key, valueJson: JSON.stringify(value) })
      .onConflictDoUpdate({
        target: schema.siteSettings.key,
        set: { valueJson: JSON.stringify(value) },
      });
  }

  it("requires gear:loan", async () => {
    await signInAsMember();
    await expect(getLoanDefaultsAction()).rejects.toThrow(
      "Forbidden: missing gear:loan",
    );
  });

  it("parses gear.caveOpenDays into ISO weekday numbers", async () => {
    await signInAsLoanManager();
    await setSetting("gear.caveOpenDays", "Mon,Wed");

    // ISO numbering — the desk feeds these straight to
    // `defaultLoanDurationDays`, which compares against `dayOfWeek`.
    expect((await getLoanDefaultsAction()).caveOpenWeekdays).toEqual([1, 3]);
  });

  it("reports the registry default when nothing is stored", async () => {
    await signInAsLoanManager();

    expect(await getLoanDefaultsAction()).toEqual({
      defaultLoanDays: 7,
      caveOpenWeekdays: [3],
    });
  });

  it("reports no open days for a blank setting", async () => {
    await signInAsLoanManager();
    await setSetting("gear.caveOpenDays", "");

    // The summer. The desk then prefills the plain loan length.
    expect((await getLoanDefaultsAction()).caveOpenWeekdays).toEqual([]);
  });

  it("falls back to the registry default on an unparseable row", async () => {
    await signInAsLoanManager();
    // The refinement guards writes, but a row written straight to D1 can
    // still be garbage. `readSetting` is fail-open, so it never reaches
    // the parser — the schema default does. Pinned because the
    // alternative reading ("degrade to no open days") is the tempting
    // one and is wrong: blank is a REAL configuration meaning the cave
    // has no hours, so answering it on a bad read would silently switch
    // the roll-forward off instead of keeping the configured behaviour.
    await setSetting("gear.caveOpenDays", "Wensday");

    expect((await getLoanDefaultsAction()).caveOpenWeekdays).toEqual([3]);
  });
});

describe("checkoutLoansAction batch size (#291)", () => {
  it("checks out 12 pieces in one batch — a loan row binds up to 18, so 7 used to be the most", async () => {
    await signInAsLoanManager();
    const typePublicId = await createTypeOk();
    const pieces: string[] = [];
    for (const i of Array.from({ length: 12 }, (_unused, k) => k)) {
      pieces.push(await createGearOk({ typePublicId, code: `BIG${i}` }));
    }
    const member = await seedUser("big-batch@example.com");

    const result = await checkoutLoansAction({
      memberPublicId: member.publicId,
      items: pieces.map((gearPublicId) => ({
        kind: "coded" as const,
        gearPublicId,
        durationDays: 7,
      })),
      notes: null,
    });

    expect(result.results.filter((r) => r.ok)).toHaveLength(12);
    expect(await getDb().select().from(schema.gearLoans)).toHaveLength(12);
  });
});
