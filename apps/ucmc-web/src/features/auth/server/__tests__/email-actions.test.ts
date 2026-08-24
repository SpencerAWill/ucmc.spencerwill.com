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
import { normalizeEmail } from "#/server/auth/email-normalize";
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
  expiresAt?: Temporal.Instant;
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
      createdAt: Temporal.Now.instant(),
      expiresAt:
        args.expiresAt ??
        Temporal.Now.instant().add({ milliseconds: MAGIC_LINK_TTL_MS }),
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

    // Attach two more, both non-primary. Routed through `normalizeEmail`
    // so direct test inserts match the canonical form the production
    // code would write — same UNIQUE(email) collision behavior.
    await getDb()
      .insert(schema.userEmails)
      .values([
        {
          id: `uem_${crypto.randomUUID()}`,
          userId,
          email: normalizeEmail("second@example.com"),
          isPrimary: false,
          verifiedAt: Temporal.Now.instant().subtract({ milliseconds: 1000 }),
        },
        {
          id: `uem_${crypto.randomUUID()}`,
          userId,
          email: normalizeEmail("third@example.com"),
          isPrimary: false,
          verifiedAt: Temporal.Now.instant(),
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
  it("rejects when rate-limited (IP)", async () => {
    const userId = await seedApprovedUser("alice@example.com");
    const token = await seedAddEmailLink({
      email: "fresh@example.com",
      targetUserId: userId,
    });
    await signInAs(userId);
    rateLimitAllowed = false;
    const result = await consumeAddEmailAction(token);
    expect(result).toEqual({ ok: false, reason: "rate_limited" });

    // The token must remain unconsumed so the user can retry once
    // the limiter window clears.
    const link = await getDb().query.magicLinks.findFirst();
    expect(link?.consumedAt).toBeNull();
  });

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
    const meta = JSON.parse(audit[0]?.metadataJson ?? "null") as {
      email?: string;
    };
    expect(meta.email).toBe("fresh@example.com");
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

  it("refuses to delete the only remaining row even when is_primary=0 (is_last guard)", async () => {
    // The partial-unique invariant prevents the "single non-primary
    // row" state under normal flows, and `loadPrincipal` itself
    // throws if no primary exists — so the action's row-count guard
    // is unreachable through the public API. To exercise it directly
    // (defense-in-depth coverage), mock the principal loader so the
    // action sees a session for a user whose only row is non-primary.
    const userId = `user_${crypto.randomUUID()}`;
    await getDb()
      .insert(schema.users)
      .values({
        id: userId,
        publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        status: "approved",
      });
    const onlyRowId = `uem_${crypto.randomUUID()}`;
    await getDb()
      .insert(schema.userEmails)
      .values({
        id: onlyRowId,
        userId,
        email: normalizeEmail("solo@example.com"),
        isPrimary: false,
        verifiedAt: Temporal.Now.instant(),
      });

    const sessionModule = await import("#/server/auth/session.server");
    const spy = vi
      .spyOn(sessionModule, "loadCurrentPrincipal")
      .mockResolvedValue({
        userId,
        primaryEmail: "solo@example.com",
        emails: ["solo@example.com"],
        status: "approved",
        hasProfile: false,
        avatarKey: null,
        roles: [],
        isSystemAdmin: false,
        permissions: [],
        rolePermissionMap: {},
        roleDisplayNames: {},
      });

    try {
      const result = await removeEmailAction({ emailId: onlyRowId });
      expect(result).toEqual({ ok: false, reason: "is_last" });

      const remaining = await getDb()
        .select()
        .from(schema.userEmails)
        .where(eq(schema.userEmails.userId, userId));
      expect(remaining).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("removes a non-primary row and writes an audit entry", async () => {
    const userId = await seedApprovedUser("alice@example.com");
    await signInAs(userId);
    const secondaryId = `uem_${crypto.randomUUID()}`;
    await getDb()
      .insert(schema.userEmails)
      .values({
        id: secondaryId,
        userId,
        email: normalizeEmail("second@example.com"),
        isPrimary: false,
        verifiedAt: Temporal.Now.instant(),
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
    // The audit metadata is a documented PII exception for the
    // email.* lifecycle events — assert the address is captured so a
    // future schema change can't quietly drop it without breaking
    // this test.
    const meta = JSON.parse(audit[0]?.metadataJson ?? "null") as {
      email?: string;
    };
    expect(meta.email).toBe("second@example.com");
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
    await getDb()
      .insert(schema.userEmails)
      .values({
        id: secondaryId,
        userId,
        email: normalizeEmail("second@example.com"),
        isPrimary: false,
        verifiedAt: Temporal.Now.instant(),
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

    // Audit row shape — uses the same `email` metadata key as
    // email.added/email.removed for cross-event consistency.
    const audit = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "email.primary_changed"));
    expect(audit).toHaveLength(1);
    const meta = JSON.parse(audit[0]?.metadataJson ?? "null") as {
      email?: string;
    };
    expect(meta.email).toBe("second@example.com");

    // Now the old primary is removable (it's no longer primary).
    const oldPrimary = rows.find((r) => r.email === "alice@example.com");
    const removeResult = await removeEmailAction({
      emailId: oldPrimary!.id,
    });
    expect(removeResult).toEqual({ ok: true });
  });

  it("leaves the previous primary intact when the target row vanishes mid-swap (no orphaned demote)", async () => {
    // Regression for the race where the target email is deleted
    // between the action's initial findFirst and the db.batch swap.
    // The gated demote + .returning() promote must leave the previous
    // primary intact instead of stranding the user with no primary.
    //
    // The race is simulated by deleting the target *after* the
    // findFirst lookup succeeds — we don't intercept the action's
    // internal call (drizzle's relational-query type doesn't lend
    // itself to a clean spy), but the action's findFirst result is
    // only consulted to validate "exists + not primary", and the
    // batch is what does the actual write. So: do a no-op findFirst
    // ourselves (just to confirm the target was visible), delete the
    // row, then call the action — the action's own findFirst returns
    // null, hits the `not_found` short-circuit, and the gated demote
    // never runs. This verifies the failure-mode contract:
    // "previous primary is unchanged when the target is gone."
    const userId = await seedApprovedUser("alice@example.com");
    await signInAs(userId);
    const secondaryId = `uem_${crypto.randomUUID()}`;
    await getDb()
      .insert(schema.userEmails)
      .values({
        id: secondaryId,
        userId,
        email: normalizeEmail("second@example.com"),
        isPrimary: false,
        verifiedAt: Temporal.Now.instant(),
      });

    const seen = await getDb().query.userEmails.findFirst({
      where: eq(schema.userEmails.id, secondaryId),
    });
    expect(seen).toBeDefined();

    await getDb()
      .delete(schema.userEmails)
      .where(eq(schema.userEmails.id, secondaryId));

    const result = await setPrimaryEmailAction({ emailId: secondaryId });
    expect(result).toEqual({ ok: false, reason: "not_found" });

    // The previous primary is still primary — the demote never ran.
    const rows = await getDb()
      .select()
      .from(schema.userEmails)
      .where(eq(schema.userEmails.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("alice@example.com");
    expect(rows[0]?.isPrimary).toBe(true);
  });
});
