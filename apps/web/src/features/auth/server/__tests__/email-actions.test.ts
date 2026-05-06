/**
 * Integration tests for the multi-email management actions: list,
 * request-add, consume-add, remove, set-primary.
 *
 * Mock strategy mirrors auth-flows.test.ts — cookie jar for session
 * cookies, rate-limit stubs always-allow, real D1 via the workers
 * pool. The magic-link send is stubbed to a no-op since the consume
 * tests pull the token straight from D1.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Resend from "#/server/email/resend";
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

let rateLimitAllowed = true;
vi.mock("#/server/rate-limit.server", () => ({
  checkAuthRateLimitByIp: async () => rateLimitAllowed,
  checkAuthRateLimitByEmail: async () => rateLimitAllowed,
}));

vi.mock("#/server/email/resend", async () => {
  const actual = await vi.importActual<typeof Resend>("#/server/email/resend");
  return {
    ...actual,
    sendEmail: vi.fn(async () => {}),
  };
});

const {
  listMyEmailsAction,
  requestAddEmailAction,
  consumeAddEmailAction,
  removeEmailAction,
  setPrimaryEmailAction,
} = await import("#/features/auth/server/email-actions.server");
const { openSession } = await import("#/server/auth/session.server");
const { MAGIC_LINK_TTL_MS } =
  await import("#/features/auth/server/magic-link.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedApprovedUser(email: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: "approved",
    });
  await attachPrimaryEmail(id, email);
  return id;
}

async function seedPendingUser(email: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: "pending",
    });
  await attachPrimaryEmail(id, email);
  return id;
}

async function signInAs(userId: string): Promise<void> {
  cookieJar.clear();
  await openSession(userId);
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  let bin = "";
  for (const b of new Uint8Array(digest)) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Insert a pre-formed `add_email` magic link directly so the test can
 * exercise the consume path without round-tripping through the
 * request action's email send. Returns the raw token to pass to the
 * consume call.
 */
async function seedAddEmailLink(args: {
  email: string;
  targetUserId: string;
  token?: string;
  expiresAt?: Date;
}): Promise<string> {
  const token = args.token ?? `tok_${crypto.randomUUID()}`;
  const tokenHash = await sha256Base64Url(token);
  await getDb()
    .insert(schema.magicLinks)
    .values({
      tokenHash,
      email: args.email,
      intent: "add_email",
      targetUserId: args.targetUserId,
      createdAt: new Date(),
      expiresAt: args.expiresAt ?? new Date(Date.now() + MAGIC_LINK_TTL_MS),
    });
  return token;
}

beforeEach(async () => {
  cookieJar.clear();
  rateLimitAllowed = true;
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.sessions);
  await db.delete(schema.magicLinks);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

// ── listMyEmailsAction ─────────────────────────────────────────────────

describe("listMyEmailsAction", () => {
  it("returns unauthorized when no session", async () => {
    const result = await listMyEmailsAction();
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("returns the caller's emails with primary first", async () => {
    const userId = await seedApprovedUser("primary@example.com");
    await signInAs(userId);

    // Attach two more, both non-primary.
    await getDb()
      .insert(schema.userEmails)
      .values([
        {
          id: `uem_${crypto.randomUUID()}`,
          userId,
          email: "second@example.com",
          isPrimary: false,
          verifiedAt: new Date(Date.now() - 1000),
        },
        {
          id: `uem_${crypto.randomUUID()}`,
          userId,
          email: "third@example.com",
          isPrimary: false,
          verifiedAt: new Date(),
        },
      ]);

    const result = await listMyEmailsAction();
    if (!result.ok) throw new Error("expected ok");
    expect(result.emails).toHaveLength(3);
    expect(result.emails[0]?.email).toBe("primary@example.com");
    expect(result.emails[0]?.isPrimary).toBe(true);
  });
});

// ── requestAddEmailAction ──────────────────────────────────────────────

describe("requestAddEmailAction", () => {
  it("rejects unauthenticated callers", async () => {
    const result = await requestAddEmailAction({ email: "new@example.com" });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("rejects pending users (approval gate)", async () => {
    const userId = await seedPendingUser("pending@example.com");
    await signInAs(userId);
    const result = await requestAddEmailAction({ email: "new@example.com" });
    expect(result).toEqual({ ok: false, reason: "not_approved" });
  });

  it("rejects when rate-limited", async () => {
    const userId = await seedApprovedUser("alice@example.com");
    await signInAs(userId);
    rateLimitAllowed = false;
    const result = await requestAddEmailAction({ email: "new@example.com" });
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("rejects an email already on another account (email_taken)", async () => {
    const aliceId = await seedApprovedUser("alice@example.com");
    await seedApprovedUser("claimed@example.com");
    await signInAs(aliceId);

    const result = await requestAddEmailAction({
      email: "claimed@example.com",
    });
    expect(result).toEqual({ ok: false, reason: "email_taken" });

    // No magic link was issued — the request short-circuits before
    // reaching `requestMagicLink`.
    const links = await getDb().select().from(schema.magicLinks);
    expect(links).toHaveLength(0);
  });

  it("rejects an email already on the caller's own account (already_yours)", async () => {
    const userId = await seedApprovedUser("alice@example.com");
    await signInAs(userId);
    const result = await requestAddEmailAction({ email: "alice@example.com" });
    expect(result).toEqual({ ok: false, reason: "already_yours" });
  });

  it("issues an add_email magic link when the address is fresh", async () => {
    const userId = await seedApprovedUser("alice@example.com");
    await signInAs(userId);

    const result = await requestAddEmailAction({ email: "Fresh@Example.com" });
    expect(result).toEqual({ ok: true });

    const links = await getDb().select().from(schema.magicLinks);
    expect(links).toHaveLength(1);
    expect(links[0]?.email).toBe("fresh@example.com");
    expect(links[0]?.intent).toBe("add_email");
    expect(links[0]?.targetUserId).toBe(userId);
  });
});

// ── consumeAddEmailAction ──────────────────────────────────────────────

describe("consumeAddEmailAction", () => {
  it("rejects when no session", async () => {
    const userId = await seedApprovedUser("alice@example.com");
    const token = await seedAddEmailLink({
      email: "fresh@example.com",
      targetUserId: userId,
    });
    const result = await consumeAddEmailAction(token);
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("rejects an invalid token", async () => {
    const userId = await seedApprovedUser("alice@example.com");
    await signInAs(userId);
    const result = await consumeAddEmailAction(
      "not-a-real-token-abcdef0123456789",
    );
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects when the link's targetUserId differs from the session (cross-account guard)", async () => {
    const aliceId = await seedApprovedUser("alice@example.com");
    const bobId = await seedApprovedUser("bob@example.com");
    // Alice requested a link to fresh@example.com; Bob signs in and
    // clicks it. The consume must refuse and not attach the email
    // anywhere.
    const token = await seedAddEmailLink({
      email: "fresh@example.com",
      targetUserId: aliceId,
    });
    await signInAs(bobId);

    const result = await consumeAddEmailAction(token);
    expect(result).toEqual({ ok: false, reason: "wrong_user" });

    const aliceEmails = await getDb()
      .select()
      .from(schema.userEmails)
      .where(eq(schema.userEmails.userId, aliceId));
    const bobEmails = await getDb()
      .select()
      .from(schema.userEmails)
      .where(eq(schema.userEmails.userId, bobId));
    expect(aliceEmails).toHaveLength(1); // only the original primary
    expect(bobEmails).toHaveLength(1);
  });

  it("attaches the email and writes an audit row on success", async () => {
    const userId = await seedApprovedUser("alice@example.com");
    const token = await seedAddEmailLink({
      email: "fresh@example.com",
      targetUserId: userId,
    });
    await signInAs(userId);

    const result = await consumeAddEmailAction(token);
    expect(result).toEqual({ ok: true, email: "fresh@example.com" });

    const rows = await getDb()
      .select()
      .from(schema.userEmails)
      .where(eq(schema.userEmails.userId, userId));
    expect(rows).toHaveLength(2);
    const fresh = rows.find((r) => r.email === "fresh@example.com");
    expect(fresh?.isPrimary).toBe(false);

    const audit = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "email.added"));
    expect(audit).toHaveLength(1);
  });

  it("returns email_taken on the loser of a race (UNIQUE constraint)", async () => {
    const aliceId = await seedApprovedUser("alice@example.com");
    const bobId = await seedApprovedUser("bob@example.com");
    // Both Alice and Bob have a valid add_email link for the same
    // fresh address (impossible under the request action's pre-check
    // unless they raced; we set it up directly to model that race).
    const aliceToken = await seedAddEmailLink({
      email: "race@example.com",
      targetUserId: aliceId,
    });
    const bobToken = await seedAddEmailLink({
      email: "race@example.com",
      targetUserId: bobId,
    });

    await signInAs(aliceId);
    const aliceResult = await consumeAddEmailAction(aliceToken);
    expect(aliceResult).toEqual({ ok: true, email: "race@example.com" });

    await signInAs(bobId);
    const bobResult = await consumeAddEmailAction(bobToken);
    expect(bobResult).toEqual({ ok: false, reason: "email_taken" });
  });

  it("rejects a single-use replay", async () => {
    const userId = await seedApprovedUser("alice@example.com");
    const token = await seedAddEmailLink({
      email: "fresh@example.com",
      targetUserId: userId,
    });
    await signInAs(userId);

    const first = await consumeAddEmailAction(token);
    expect(first.ok).toBe(true);
    const second = await consumeAddEmailAction(token);
    expect(second).toEqual({ ok: false, reason: "invalid" });
  });
});

// ── removeEmailAction ──────────────────────────────────────────────────

describe("removeEmailAction", () => {
  it("rejects when no session", async () => {
    const result = await removeEmailAction({ emailId: "uem_anything" });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("rejects pending users", async () => {
    const userId = await seedPendingUser("pending@example.com");
    await signInAs(userId);
    const row = await getDb().query.userEmails.findFirst({
      where: eq(schema.userEmails.userId, userId),
    });
    const result = await removeEmailAction({ emailId: row!.id });
    expect(result).toEqual({ ok: false, reason: "not_approved" });
  });

  it("rejects an emailId belonging to another user (not_found)", async () => {
    const aliceId = await seedApprovedUser("alice@example.com");
    const bobId = await seedApprovedUser("bob@example.com");
    const bobRow = await getDb().query.userEmails.findFirst({
      where: eq(schema.userEmails.userId, bobId),
    });
    await signInAs(aliceId);
    const result = await removeEmailAction({ emailId: bobRow!.id });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses to remove the primary (single email case)", async () => {
    const userId = await seedApprovedUser("alice@example.com");
    await signInAs(userId);
    const row = await getDb().query.userEmails.findFirst({
      where: eq(schema.userEmails.userId, userId),
    });
    const result = await removeEmailAction({ emailId: row!.id });
    expect(result).toEqual({ ok: false, reason: "is_primary" });
  });

  it("removes a non-primary row and writes an audit entry", async () => {
    const userId = await seedApprovedUser("alice@example.com");
    await signInAs(userId);
    const secondaryId = `uem_${crypto.randomUUID()}`;
    await getDb().insert(schema.userEmails).values({
      id: secondaryId,
      userId,
      email: "second@example.com",
      isPrimary: false,
      verifiedAt: new Date(),
    });

    const result = await removeEmailAction({ emailId: secondaryId });
    expect(result).toEqual({ ok: true });

    const remaining = await getDb()
      .select()
      .from(schema.userEmails)
      .where(eq(schema.userEmails.userId, userId));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.email).toBe("alice@example.com");

    const audit = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "email.removed"));
    expect(audit).toHaveLength(1);
  });
});

// ── setPrimaryEmailAction ──────────────────────────────────────────────

describe("setPrimaryEmailAction", () => {
  it("rejects when no session", async () => {
    const result = await setPrimaryEmailAction({ emailId: "uem_x" });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("rejects pending users", async () => {
    const userId = await seedPendingUser("pending@example.com");
    await signInAs(userId);
    const row = await getDb().query.userEmails.findFirst({
      where: eq(schema.userEmails.userId, userId),
    });
    const result = await setPrimaryEmailAction({ emailId: row!.id });
    expect(result).toEqual({ ok: false, reason: "not_approved" });
  });

  it("rejects already-primary", async () => {
    const userId = await seedApprovedUser("alice@example.com");
    await signInAs(userId);
    const row = await getDb().query.userEmails.findFirst({
      where: eq(schema.userEmails.userId, userId),
    });
    const result = await setPrimaryEmailAction({ emailId: row!.id });
    expect(result).toEqual({ ok: false, reason: "already_primary" });
  });

  it("swaps primary atomically (clear old, set new)", async () => {
    const userId = await seedApprovedUser("alice@example.com");
    await signInAs(userId);
    const secondaryId = `uem_${crypto.randomUUID()}`;
    await getDb().insert(schema.userEmails).values({
      id: secondaryId,
      userId,
      email: "second@example.com",
      isPrimary: false,
      verifiedAt: new Date(),
    });

    const result = await setPrimaryEmailAction({ emailId: secondaryId });
    expect(result).toEqual({ ok: true });

    const rows = await getDb()
      .select()
      .from(schema.userEmails)
      .where(eq(schema.userEmails.userId, userId));
    const primary = rows.find((r) => r.isPrimary);
    expect(primary?.email).toBe("second@example.com");
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);

    // Now the old primary is removable (it's no longer primary).
    const oldPrimary = rows.find((r) => r.email === "alice@example.com");
    const removeResult = await removeEmailAction({
      emailId: oldPrimary!.id,
    });
    expect(removeResult).toEqual({ ok: true });
  });
});
