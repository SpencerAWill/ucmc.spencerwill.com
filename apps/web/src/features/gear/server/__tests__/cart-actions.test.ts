import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WAIVER_VERSION } from "#/config/legal";
import { currentWaiverCycle } from "#/config/waiver-cycle";
import { CART_TOKEN_PREFIX } from "#/features/gear/lib/cart-token";
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

const {
  addToCartAction,
  clearCartAction,
  getMyCartAction,
  mintCartTokenAction,
  removeFromCartAction,
  resolveCartTokenAction,
} = await import("#/features/gear/server/cart-actions.server");
const { createGearAction, retireGearAction } =
  await import("#/features/gear/server/gear-actions.server");
const { createGearTypeAction } =
  await import("#/features/gear/server/gear-types-actions.server");
const { checkoutLoansAction } =
  await import("#/features/gear/server/loans-actions.server");
const { openSession } = await import("#/server/auth/session.server");
const { getKv } = await import("#/server/kv");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(
  email: string,
  fullName = "Cart Member",
  opts?: { status?: schema.UserStatus },
): Promise<{ id: string; publicId: string }> {
  const id = `user_${crypto.randomUUID()}`;
  const publicId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId,
      status: opts?.status ?? "approved",
      approvedAt: opts?.status === "approved" || !opts ? new Date() : null,
    });
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

async function attestCurrentWaiver(userId: string): Promise<void> {
  await getDb()
    .insert(schema.waiverAttestations)
    .values({
      id: `wa_${crypto.randomUUID()}`,
      userId,
      cycle: currentWaiverCycle(),
      version: WAIVER_VERSION,
      attestedAt: new Date(),
    });
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

async function signInAsApprovedMemberWithWaiver(): Promise<{
  id: string;
  publicId: string;
}> {
  const user = await seedUser(
    `cart-member-${crypto.randomUUID()}@example.com`,
    "Cart Member",
  );
  await assignRole(user.id, "role_member");
  await attestCurrentWaiver(user.id);
  await signInAs(user.id);
  return user;
}

async function signInAsLoanOfficer(): Promise<{ id: string }> {
  const user = await seedUser(
    `loan-officer-${crypto.randomUUID()}@example.com`,
    "Loan Officer",
  );
  await assignRole(user.id, "role_system_admin");
  await signInAs(user.id);
  return user;
}

async function createTypeOk(): Promise<string> {
  // Officer needed to create types; seed one + sign in to bootstrap.
  await signInAsLoanOfficer();
  const r = await createGearTypeAction({
    name: `Cart Type ${crypto.randomUUID()}`,
    prefix: "CR",
    description: null,
  });
  if (!r.ok) throw new Error(`createGearType failed: ${JSON.stringify(r)}`);
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
    description: "Cart test gear",
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

async function clearCartKv(): Promise<void> {
  const kv = getKv();
  const cart = await kv.list({ prefix: "gear-cart:" });
  await Promise.all(cart.keys.map((k) => kv.delete(k.name)));
  const tokens = await kv.list({ prefix: "gear-cart-token:" });
  await Promise.all(tokens.keys.map((k) => kv.delete(k.name)));
}

beforeEach(async () => {
  cookieJar.clear();
  await clearCartKv();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.gearLoans);
  await db.delete(schema.gearTagAssignments);
  await db.delete(schema.gear);
  await db.delete(schema.gearTags);
  await db.delete(schema.gearTypes);
  await db.delete(schema.waiverAttestations);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

afterEach(() => {
  cookieJar.clear();
});

// ── authorization ──────────────────────────────────────────────────────

describe("cart-actions authorization", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(getMyCartAction()).rejects.toThrow("Not signed in");
    await expect(addToCartAction({ gearPublicId: "x" })).rejects.toThrow(
      "Not signed in",
    );
    await expect(clearCartAction()).rejects.toThrow("Not signed in");
    await expect(mintCartTokenAction()).rejects.toThrow("Not signed in");
  });

  it("rejects approved members who lack a current-cycle waiver", async () => {
    const user = await seedUser("no-waiver@example.com");
    await assignRole(user.id, "role_member");
    await signInAs(user.id);
    await expect(getMyCartAction()).rejects.toThrow(/waiver/);
    await expect(addToCartAction({ gearPublicId: "x" })).rejects.toThrow(
      /waiver/,
    );
  });

  it("rejects pending / non-approved members even with a waiver row", async () => {
    const user = await seedUser("pending@example.com", "Pending User", {
      status: "pending",
    });
    await assignRole(user.id, "role_member");
    await attestCurrentWaiver(user.id);
    await signInAs(user.id);
    await expect(getMyCartAction()).rejects.toThrow(/approved/);
  });

  it("resolveCartTokenAction requires gear:loan", async () => {
    await signInAsApprovedMemberWithWaiver();
    await expect(
      resolveCartTokenAction({ token: `${CART_TOKEN_PREFIX}fake` }),
    ).rejects.toThrow(/gear:loan/);
  });
});

// ── add / remove / clear / get ─────────────────────────────────────────

describe("addToCartAction", () => {
  it("adds a loanable piece and surfaces it via getMyCartAction", async () => {
    const typePublicId = await createTypeOk();
    const gearPublicId = await createGearOk({ typePublicId, code: "CR1" });
    await signInAsApprovedMemberWithWaiver();

    const add = await addToCartAction({ gearPublicId });
    expect(add).toEqual({ ok: true });

    const cart = await getMyCartAction();
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({
      publicId: gearPublicId,
      code: "CR1",
      availability: "loanable",
    });
  });

  it("rejects retired pieces with reason 'retired'", async () => {
    const typePublicId = await createTypeOk();
    const gearPublicId = await createGearOk({ typePublicId, code: "CR2" });
    await retireGearAction({ publicId: gearPublicId, reason: null });
    await signInAsApprovedMemberWithWaiver();

    const result = await addToCartAction({ gearPublicId });
    expect(result).toEqual({ ok: false, reason: "retired" });
  });

  it("rejects code-less pieces with reason 'no_code'", async () => {
    const typePublicId = await createTypeOk();
    const gearPublicId = await createGearOk({ typePublicId, code: null });
    await signInAsApprovedMemberWithWaiver();

    const result = await addToCartAction({ gearPublicId });
    expect(result).toEqual({ ok: false, reason: "no_code" });
  });

  it("rejects duplicates with reason 'already_in_cart'", async () => {
    const typePublicId = await createTypeOk();
    const gearPublicId = await createGearOk({ typePublicId, code: "CR3" });
    await signInAsApprovedMemberWithWaiver();

    await addToCartAction({ gearPublicId });
    const second = await addToCartAction({ gearPublicId });
    expect(second).toEqual({ ok: false, reason: "already_in_cart" });
  });

  it("rejects unknown publicIds with reason 'not_found'", async () => {
    await signInAsApprovedMemberWithWaiver();
    const result = await addToCartAction({ gearPublicId: "does-not-exist" });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("removeFromCartAction", () => {
  it("removes the named piece and is idempotent for missing ones", async () => {
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CR4" });
    const b = await createGearOk({ typePublicId, code: "CR5" });
    await signInAsApprovedMemberWithWaiver();
    await addToCartAction({ gearPublicId: a });
    await addToCartAction({ gearPublicId: b });

    await removeFromCartAction({ gearPublicId: a });
    const cart = await getMyCartAction();
    expect(cart.items.map((i) => i.publicId)).toEqual([b]);

    // No-op for already-absent piece — still resolves ok.
    await expect(removeFromCartAction({ gearPublicId: a })).resolves.toEqual({
      ok: true,
    });
  });
});

describe("clearCartAction", () => {
  it("empties the cart", async () => {
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CR6" });
    await signInAsApprovedMemberWithWaiver();
    await addToCartAction({ gearPublicId: a });

    await clearCartAction();
    const cart = await getMyCartAction();
    expect(cart.items).toEqual([]);
  });
});

describe("getMyCartAction availability", () => {
  it("reports 'on_loan' when the piece is currently checked out", async () => {
    const typePublicId = await createTypeOk();
    const gearPublicId = await createGearOk({ typePublicId, code: "CR7" });

    // Member adds; officer separately checks the piece out to someone else.
    const member = await signInAsApprovedMemberWithWaiver();
    await addToCartAction({ gearPublicId });

    const borrower = await seedUser("borrower@example.com", "Borrower");
    const officer = await signInAsLoanOfficer();
    await checkoutLoansAction({
      memberPublicId: borrower.publicId,
      items: [{ gearPublicId, durationDays: 7 }],
      notes: null,
    });

    await signInAs(member.id);
    const cart = await getMyCartAction();
    expect(cart.items[0]?.availability).toBe("on_loan");
    // Sanity — the officer & borrower bookkeeping is incidental, just
    // making sure the cross-test sign-in didn't lose the cart.
    expect(officer.id).toBeTruthy();
  });

  it("reports 'not_serviceable' when condition is not 'serviceable'", async () => {
    const typePublicId = await createTypeOk();
    const gearPublicId = await createGearOk({
      typePublicId,
      code: "CR8",
      condition: "needs_repair",
    });
    await signInAsApprovedMemberWithWaiver();
    await addToCartAction({ gearPublicId });

    const cart = await getMyCartAction();
    expect(cart.items[0]?.availability).toBe("not_serviceable");
  });

  it("prunes hard-deleted gear silently", async () => {
    const typePublicId = await createTypeOk();
    const gearPublicId = await createGearOk({ typePublicId, code: "CR9" });
    await signInAsApprovedMemberWithWaiver();
    await addToCartAction({ gearPublicId });

    // Hard delete from D1 directly (simulates a maintenance op).
    await getDb()
      .delete(schema.gear)
      .where(eq(schema.gear.publicId, gearPublicId));

    const cart = await getMyCartAction();
    expect(cart.items).toEqual([]);
  });
});

// ── mint / resolve ─────────────────────────────────────────────────────

describe("mintCartTokenAction + resolveCartTokenAction", () => {
  it("round-trips a populated cart to the officer's resolve call", async () => {
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CR10" });
    const b = await createGearOk({ typePublicId, code: "CR11" });

    const member = await signInAsApprovedMemberWithWaiver();
    await addToCartAction({ gearPublicId: a });
    await addToCartAction({ gearPublicId: b });
    const minted = await mintCartTokenAction();
    if (!minted.ok) throw new Error("expected mint.ok");
    expect(minted.token.startsWith(CART_TOKEN_PREFIX)).toBe(true);

    await signInAsLoanOfficer();
    const resolved = await resolveCartTokenAction({ token: minted.token });
    if (!resolved.ok) throw new Error("expected resolve.ok");
    expect(resolved.cart.memberPublicId).toBe(member.publicId);
    expect(resolved.cart.items.map((i) => i.publicId).sort()).toEqual(
      [a, b].sort(),
    );
    expect(
      resolved.cart.items.every((i) => i.availability === "loanable"),
    ).toBe(true);
  });

  it("resolve uses the mint-time snapshot, not the live cart", async () => {
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CR12" });
    const b = await createGearOk({ typePublicId, code: "CR13" });

    const member = await signInAsApprovedMemberWithWaiver();
    await addToCartAction({ gearPublicId: a });
    const minted = await mintCartTokenAction();
    if (!minted.ok) throw new Error("expected mint.ok");

    // Member mutates cart after minting; the QR should still resolve
    // to the originally-snapshotted contents.
    await addToCartAction({ gearPublicId: b });
    await removeFromCartAction({ gearPublicId: a });

    await signInAsLoanOfficer();
    const resolved = await resolveCartTokenAction({ token: minted.token });
    if (!resolved.ok) throw new Error("expected resolve.ok");
    expect(resolved.cart.items.map((i) => i.publicId)).toEqual([a]);
    expect(resolved.cart.memberPublicId).toBe(member.publicId);
  });

  it("returns reason 'expired' when the token is unknown / TTL'd out", async () => {
    await signInAsLoanOfficer();
    const resolved = await resolveCartTokenAction({
      token: `${CART_TOKEN_PREFIX}does-not-exist`,
    });
    expect(resolved).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects mint on an empty cart with reason 'empty_cart'", async () => {
    await signInAsApprovedMemberWithWaiver();
    const minted = await mintCartTokenAction();
    expect(minted).toEqual({ ok: false, reason: "empty_cart" });
  });

  it("emits exactly one loan.cart_scanned audit event per successful resolve", async () => {
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CR14" });
    const member = await signInAsApprovedMemberWithWaiver();
    await addToCartAction({ gearPublicId: a });
    const minted = await mintCartTokenAction();
    if (!minted.ok) throw new Error("expected mint.ok");

    const officer = await signInAsLoanOfficer();
    const resolved = await resolveCartTokenAction({ token: minted.token });
    if (!resolved.ok) throw new Error("expected resolve.ok");

    const rows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "loan.cart_scanned"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(officer.id);
    expect(rows[0]?.targetType).toBe("user");
    expect(rows[0]?.targetId).toBe(member.id);
    const metadata = JSON.parse(rows[0]?.metadataJson ?? "null") as {
      itemCount?: number;
    } | null;
    expect(metadata?.itemCount).toBe(1);
  });
});

// ── review-gap coverage ─────────────────────────────────────────────────

describe("getMyCartAction prune behavior", () => {
  it("does NOT rewrite KV when no prune is needed (TTL stays stable)", async () => {
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CR20" });
    const member = await signInAsApprovedMemberWithWaiver();
    await addToCartAction({ gearPublicId: a });

    // Read the raw KV value before, then after a no-prune getMyCart.
    // If the action rewrote KV, the stored JSON's `updatedAt` would
    // change (putCart sets it to Date.now()). Identical bytes ⇒ no
    // write, which is the TTL-stability behavior we want.
    const key = `gear-cart:user:${member.id}`;
    const before = await getKv().get(key);
    expect(before).not.toBeNull();

    await getMyCartAction();

    const after = await getKv().get(key);
    expect(after).toBe(before);
  });

  it("DOES rewrite KV when hard-deleted gear is pruned", async () => {
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CR21" });
    const member = await signInAsApprovedMemberWithWaiver();
    await addToCartAction({ gearPublicId: a });

    const key = `gear-cart:user:${member.id}`;
    const before = await getKv().get(key);

    // Hard-delete the gear; next getMyCart should prune + rewrite.
    await getDb().delete(schema.gear).where(eq(schema.gear.publicId, a));
    await getMyCartAction();

    const after = await getKv().get(key);
    expect(after).not.toBe(before);
    const parsed = JSON.parse(after ?? "null") as { items: unknown[] };
    expect(parsed.items).toEqual([]);
  });
});

describe("hydration surfaces no_code for code-cleared rows", () => {
  it("surfaces a row as availability='no_code' when its code is nulled post-add", async () => {
    const typePublicId = await createTypeOk();
    const a = await createGearOk({ typePublicId, code: "CR22" });
    await signInAsApprovedMemberWithWaiver();
    await addToCartAction({ gearPublicId: a });

    // Simulate an officer clearing the code (e.g. retire/unretire
    // cycle, or a manual edit). The row stays in inventory but loses
    // its scannable identifier.
    await getDb()
      .update(schema.gear)
      .set({ code: null })
      .where(eq(schema.gear.publicId, a));

    const cart = await getMyCartAction();
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]?.code).toBeNull();
    expect(cart.items[0]?.availability).toBe("no_code");
  });
});
