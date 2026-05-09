/**
 * Integration tests for multi-step auth flows. Each test exercises a
 * real sequence of action calls (not individual functions in isolation)
 * against a Miniflare-simulated D1, verifying the end-to-end state
 * transitions.
 *
 * Same mock strategy as server-fns.test.ts: cookie jar for session/proof
 * cookies, rate-limit stubs always-allow, turnstile stub always-pass.
 */
import {
  and as drizzleAnd,
  eq as drizzleEq,
  ne as drizzleNe,
} from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Resend from "#/server/email/resend";
import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

// ── mocks (declared before action imports) ──────────────────────────────

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
  checkHealthRateLimit: async () => rateLimitAllowed,
}));

vi.mock("#/features/auth/server/turnstile.server", () => ({
  verifyTurnstile: async () => true,
}));

// `sendEmail` would otherwise throw `EmailNotConfiguredError` in the
// test environment (no `RESEND_API_KEY`, no `MAILPIT_URL`). The
// magic-link flow under test reads the token straight from D1, so
// the actual email send is irrelevant — stub to a no-op.
vi.mock("#/server/email/resend", async () => {
  const actual = await vi.importActual<typeof Resend>("#/server/email/resend");
  return {
    ...actual,
    sendEmail: vi.fn(async () => {}),
  };
});

// ── imports (after mocks) ───────────────────────────────────────────────

const {
  requestMagicLinkAction,
  consumeMagicLinkAction,
  submitProfileAction,
  getSessionAction,
  signOutAction,
} = await import("#/features/auth/server/magic-link-actions.server");
const { MAGIC_LINK_TTL_MS } =
  await import("#/features/auth/server/magic-link.server");
const {
  approveRegistrationsAction,
  rejectRegistrationsAction,
  listPendingRegistrationsAction,
} = await import("#/features/members/server/member-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ─────────────────────────────────────────────────────────────

const TEST_EMAIL = "flow-test@example.com";

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

async function seedUser(args: {
  email: string;
  status?: schema.UserStatus;
  withProfile?: boolean;
}): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: args.status ?? "pending",
    });
  await attachPrimaryEmail(id, args.email);
  if (args.withProfile) {
    await getDb().insert(schema.profiles).values({
      userId: id,
      fullName: "Test User",
      preferredName: "Test",
      phone: "+15135551212",
      ucAffiliation: "student",
      updatedAt: new Date(),
    });
  }
  return id;
}

async function seedMagicLink(args: {
  email: string;
  intent: schema.MagicLinkIntent;
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
      intent: args.intent,
      createdAt: new Date(),
      expiresAt: args.expiresAt ?? new Date(Date.now() + MAGIC_LINK_TTL_MS),
    });
  return token;
}

async function seedApprover(): Promise<string> {
  const id = await seedUser({
    email: "exec@example.com",
    status: "approved",
    withProfile: true,
  });
  // The `beforeEach` hook wipes roles + permissions, so re-seed the
  // bits this fixture needs. Grants `members:manage` to system_admin.
  await getDb().insert(schema.roles).values({
    id: "role_system_admin",
    name: "system_admin",
    description: "System administrator",
  });
  await getDb().insert(schema.permissions).values({
    id: "perm_members_manage",
    name: "members:manage",
    description: "Manage members",
  });
  await getDb().insert(schema.rolePermissions).values({
    roleId: "role_system_admin",
    permissionId: "perm_members_manage",
  });
  await getDb()
    .insert(schema.userRoles)
    .values({ userId: id, roleId: "role_system_admin" });
  // Also seed the member role (granted on approval).
  await getDb()
    .insert(schema.roles)
    .values({ id: "role_member", name: "member", description: "Member" })
    .onConflictDoNothing();
  return id;
}

function signInAs(userId: string): Promise<void> {
  return openSession(userId);
}

const validProfile = {
  fullName: "Alice Smith",
  preferredName: "Alice",
  phone: "+15135551234",
  emergencyContacts: [
    {
      name: "Bob Smith",
      phone: "+15135555678",
      relationship: "parent" as const,
    },
  ],
  ucAffiliation: "student" as const,
  bio: "",
  policiesAck: true as const,
};

// ── setup ───────────────────────────────────────────────────────────────

beforeEach(async () => {
  cookieJar.clear();
  rateLimitAllowed = true;
  const db = getDb();
  await db.delete(schema.userRoles);
  await db.delete(schema.rolePermissions);
  await db.delete(schema.sessions);
  await db.delete(schema.emergencyContacts);
  await db.delete(schema.profiles);
  await db.delete(schema.magicLinks);
  // Drop the blocklist alongside other per-test state. Without this,
  // a row seeded by the magic-link / add-email blocklist tests would
  // bleed into the next test's `requestMagicLinkAction` and silently
  // suppress its email.
  await db.delete(schema.bannedEmails);
  await db.delete(schema.users);
  await db.delete(schema.permissions);
  await db.delete(schema.roles);
});

// ── tests ───────────────────────────────────────────────────────────────

describe("magic-link registration flow", () => {
  it("request → consume → proof cookie → submit profile → session + pending", async () => {
    // 1. Request magic link (creates token in D1).
    await requestMagicLinkAction({
      email: TEST_EMAIL,
      turnstileToken: "",
    });

    // Verify a magic link was created in D1.
    const links = await getDb().select().from(schema.magicLinks);
    expect(links).toHaveLength(1);
    expect(links[0].email).toBe(TEST_EMAIL);

    // 2. Consume the token. Since no user row exists, should return
    //    mode="proof" (not session) and set the proof cookie.
    // We need the raw token to consume — extract from DB by looking up
    // the hash. Instead, seed a known token directly.
    const token = await seedMagicLink({
      email: TEST_EMAIL,
      intent: "register",
    });
    const result = await consumeMagicLinkAction(token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("proof");

    // Proof cookie should be set.
    const proofCookie = cookieJar.get("ucmc_proof");
    expect(proofCookie).toBeDefined();

    // 3. Submit profile (using proof cookie, no session yet).
    await submitProfileAction(validProfile);

    // 4. Verify: user row exists with status=pending, profile exists,
    //    session cookie set (proof cookie cleared).
    const userEmailRow = await getDb().query.userEmails.findFirst({
      where: (ue, { eq }) => eq(ue.email, TEST_EMAIL),
    });
    expect(userEmailRow).toBeDefined();
    const user = await getDb().query.users.findFirst({
      where: (u, { eq }) => eq(u.id, userEmailRow!.userId),
    });
    expect(user).toBeDefined();
    expect(user!.status).toBe("pending");

    const profile = await getDb().query.profiles.findFirst({
      where: (p, { eq }) => eq(p.userId, user!.id),
    });
    expect(profile).toBeDefined();
    expect(profile!.fullName).toBe("Alice Smith");

    // Session cookie should be set.
    const sessionCookie = cookieJar.get("ucmc_session");
    expect(sessionCookie).toBeDefined();

    // getSession should return the principal.
    const { principal } = await getSessionAction();
    expect(principal).not.toBeNull();
    expect(principal!.primaryEmail).toBe(TEST_EMAIL);
    expect(principal!.status).toBe("pending");
    expect(principal!.hasProfile).toBe(true);
  });
});

describe("magic-link sign-in (existing user)", () => {
  it("opens a session directly for an existing approved user", async () => {
    const userId = await seedUser({
      email: TEST_EMAIL,
      status: "approved",
      withProfile: true,
    });
    const token = await seedMagicLink({
      email: TEST_EMAIL,
      intent: "login",
    });

    const result = await consumeMagicLinkAction(token);
    expect(result).toMatchObject({
      ok: true,
      mode: "session",
      status: "approved",
      hasProfile: true,
    });

    // Session should be active.
    const { principal } = await getSessionAction();
    expect(principal).not.toBeNull();
    expect(principal!.userId).toBe(userId);
  });

  it("opens a session for a pending user (no profile)", async () => {
    await seedUser({ email: TEST_EMAIL, status: "pending" });
    const token = await seedMagicLink({
      email: TEST_EMAIL,
      intent: "login",
    });

    const result = await consumeMagicLinkAction(token);
    expect(result).toMatchObject({
      ok: true,
      mode: "session",
      status: "pending",
      hasProfile: false,
    });
  });
});

describe("banned email blocklist", () => {
  // The blocklist is populated by `banMembersAction`, but for unit-
  // level isolation we seed `bannedEmails` directly. The action-level
  // tests live in `member-actions.test.ts`; these tests exercise the
  // *consumer* paths.
  async function seedBlocklist(email: string): Promise<void> {
    await getDb().insert(schema.bannedEmails).values({
      email,
      userId: null,
      bannedAt: new Date(),
      bannedBy: "actor",
      reason: "policy violation",
      createdAt: new Date(),
    });
  }

  it("requestMagicLinkAction silently drops banned emails — no row, no email", async () => {
    await seedBlocklist(TEST_EMAIL);

    await requestMagicLinkAction({
      email: TEST_EMAIL,
      turnstileToken: "",
    });

    // No magic-link row written. Same observable success shape as
    // the unknown-email path — caller can't distinguish "banned" from
    // "fresh address that never registered."
    const links = await getDb().select().from(schema.magicLinks);
    expect(links).toHaveLength(0);
  });

  it("requestMagicLinkAction still preserves the timing-pad floor", async () => {
    // The blocklist branch must keep the ≥500ms pad so the response
    // time can't distinguish banned from honored. Lower bound only —
    // upper bound varies with system jitter and would flake.
    await seedBlocklist(TEST_EMAIL);

    const start = Date.now();
    await requestMagicLinkAction({
      email: TEST_EMAIL,
      turnstileToken: "",
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(500);
  });

  it("consumeMagicLinkAction refuses an outstanding token for an orphaned blocklist row", async () => {
    // The "blocklist survives user-row delete" promise is meaningless
    // if the registration path doesn't honor it. Set up: blocklist
    // row exists with `userId = NULL` (the original banned user is
    // gone), AND a pre-ban-minted token still resolves to the address.
    // The consume must refuse rather than fall through to first-time
    // registration.
    await seedBlocklist(TEST_EMAIL);
    // No `users` row for TEST_EMAIL — `resolveUserByEmail` will
    // return null. Without the orphaned-blocklist guard, the consume
    // would write a proof cookie and route to /register/profile.
    const token = await seedMagicLink({
      email: TEST_EMAIL,
      intent: "register",
    });

    const result = await consumeMagicLinkAction(token);
    expect(result).toEqual({ ok: false, reason: "invalid" });

    // No proof cookie was set — the bypass would have left one.
    const proofCookie = cookieJar.get("ucmc_proof");
    expect(proofCookie).toBeUndefined();
  });

  it("submitProfileAction refuses a proof cookie for a blocklisted email", async () => {
    // Defense-in-depth for a proof cookie minted in the narrow
    // window between consume and submit (e.g. attacker has a stale
    // cookie from a prior session). The consume guard above closes
    // the common path; this test pins the second-layer check that
    // `submitProfileAction` refuses to seed a fresh `users` row when
    // the address became blocked between the cookie issue and
    // submit.
    await seedBlocklist(TEST_EMAIL);
    // Manually plant a proof cookie as if the consume had succeeded
    // at a moment when the email wasn't yet blocklisted.
    const { writeProofCookie } =
      await import("#/server/auth/proof-cookie.server");
    await writeProofCookie({
      email: TEST_EMAIL,
      intent: "register",
      issuedAt: Date.now(),
    });

    await expect(
      submitProfileAction({
        ...validProfile,
        policiesAck: true as const,
      }),
    ).rejects.toThrow(/not authorized/i);

    // No `users` row was created.
    const rows = await getDb()
      .select()
      .from(schema.userEmails)
      .where(drizzleEq(schema.userEmails.email, TEST_EMAIL));
    expect(rows).toHaveLength(0);
  });

  it("consumeMagicLinkAction refuses an outstanding token for a banned user", async () => {
    // Token minted before the ban (or seeded directly for the test) —
    // refuses with `invalid` rather than opening a session.
    await seedUser({
      email: TEST_EMAIL,
      status: "banned",
      withProfile: true,
    });
    const token = await seedMagicLink({
      email: TEST_EMAIL,
      intent: "login",
    });

    const result = await consumeMagicLinkAction(token);
    expect(result).toEqual({ ok: false, reason: "invalid" });

    // No session opened.
    const sessionCookie = cookieJar.get("ucmc_session");
    expect(sessionCookie).toBeUndefined();
  });
});

describe("token security", () => {
  it("rejects a replayed (already-consumed) token", async () => {
    await seedUser({
      email: TEST_EMAIL,
      status: "approved",
      withProfile: true,
    });
    const token = await seedMagicLink({
      email: TEST_EMAIL,
      intent: "login",
    });

    // First consume: succeeds.
    const first = await consumeMagicLinkAction(token);
    expect(first.ok).toBe(true);

    // Second consume: fails.
    cookieJar.clear(); // fresh request
    const second = await consumeMagicLinkAction(token);
    expect(second.ok).toBe(false);
  });

  it("rejects an expired token", async () => {
    await seedUser({
      email: TEST_EMAIL,
      status: "approved",
      withProfile: true,
    });
    const token = await seedMagicLink({
      email: TEST_EMAIL,
      intent: "login",
      expiresAt: new Date(Date.now() - 1000), // expired 1s ago
    });

    const result = await consumeMagicLinkAction(token);
    expect(result.ok).toBe(false);
  });

  it("rejects a completely unknown token", async () => {
    const result = await consumeMagicLinkAction("totally_fake_token_value");
    expect(result.ok).toBe(false);
  });
});

describe("sign out", () => {
  it("clears the session cookie and invalidates the session", async () => {
    const userId = await seedUser({
      email: TEST_EMAIL,
      status: "approved",
      withProfile: true,
    });
    await signInAs(userId);
    expect(cookieJar.has("ucmc_session")).toBe(true);

    await signOutAction();
    expect(cookieJar.has("ucmc_session")).toBe(false);

    const { principal } = await getSessionAction();
    expect(principal).toBeNull();
  });
});

describe("approval flow", () => {
  it("approve flips status to approved and grants member role", async () => {
    const approverId = await seedApprover();
    const pendingId = await seedUser({
      email: "pending@example.com",
      status: "pending",
      withProfile: true,
    });

    // Sign in as the approver.
    await signInAs(approverId);

    await approveRegistrationsAction([pendingId]);

    const user = await getDb().query.users.findFirst({
      where: (u, { eq }) => eq(u.id, pendingId),
    });
    expect(user!.status).toBe("approved");
    expect(user!.approvedBy).toBe(approverId);
    expect(user!.approvedAt).toBeTruthy();

    // Member role should be granted.
    const roles = await getDb()
      .select()
      .from(schema.userRoles)
      .where(drizzleEq(schema.userRoles.userId, pendingId));
    expect(roles.some((r) => r.roleId === "role_member")).toBe(true);
  });

  it("reject flips status to rejected", async () => {
    const approverId = await seedApprover();
    const pendingId = await seedUser({
      email: "pending@example.com",
      status: "pending",
    });

    await signInAs(approverId);
    await rejectRegistrationsAction([pendingId]);

    const user = await getDb().query.users.findFirst({
      where: (u, { eq }) => eq(u.id, pendingId),
    });
    expect(user!.status).toBe("rejected");
  });

  it("throws when caller lacks members:manage permission", async () => {
    const regularUser = await seedUser({
      email: "member@example.com",
      status: "approved",
      withProfile: true,
    });
    await signInAs(regularUser);

    await expect(approveRegistrationsAction(["some_user_id"])).rejects.toThrow(
      "members:manage",
    );
  });

  it("throws when not signed in", async () => {
    await expect(approveRegistrationsAction(["some_user_id"])).rejects.toThrow(
      "Not signed in",
    );
  });
});

describe("bulk approve/reject", () => {
  it("approves multiple users in one call", async () => {
    const approverId = await seedApprover();
    const ids = await Promise.all([
      seedUser({
        email: "a@example.com",
        status: "pending",
        withProfile: true,
      }),
      seedUser({
        email: "b@example.com",
        status: "pending",
        withProfile: true,
      }),
      seedUser({
        email: "c@example.com",
        status: "pending",
        withProfile: true,
      }),
    ]);

    await signInAs(approverId);
    await approveRegistrationsAction(ids);

    for (const id of ids) {
      const user = await getDb().query.users.findFirst({
        where: (u, { eq }) => eq(u.id, id),
      });
      expect(user!.status).toBe("approved");
    }

    // All should have member role.
    const roleGrants = await getDb()
      .select()
      .from(schema.userRoles)
      .where(drizzleEq(schema.userRoles.roleId, "role_member"));
    expect(roleGrants.length).toBeGreaterThanOrEqual(ids.length);
  });

  it("rejects multiple users in one call", async () => {
    const approverId = await seedApprover();
    const ids = await Promise.all([
      seedUser({ email: "d@example.com", status: "pending" }),
      seedUser({ email: "e@example.com", status: "pending" }),
    ]);

    await signInAs(approverId);
    await rejectRegistrationsAction(ids);

    for (const id of ids) {
      const user = await getDb().query.users.findFirst({
        where: (u, { eq }) => eq(u.id, id),
      });
      expect(user!.status).toBe("rejected");
    }
  });
});

describe("list pending registrations", () => {
  it("returns pending users with profile info", async () => {
    const approverId = await seedApprover();
    await seedUser({
      email: "with-profile@example.com",
      status: "pending",
      withProfile: true,
    });
    await seedUser({
      email: "no-profile@example.com",
      status: "pending",
    });
    // This approved user should NOT appear.
    await seedUser({
      email: "approved@example.com",
      status: "approved",
      withProfile: true,
    });

    await signInAs(approverId);
    const result = await listPendingRegistrationsAction({});

    expect(result.total).toBe(2);
    expect(result.rows).toHaveLength(2);

    const withProfile = result.rows.find(
      (r) => r.email === "with-profile@example.com",
    );
    expect(withProfile!.hasProfile).toBe(true);
    expect(withProfile!.fullName).toBe("Test User");

    const noProfile = result.rows.find(
      (r) => r.email === "no-profile@example.com",
    );
    expect(noProfile!.hasProfile).toBe(false);
    expect(noProfile!.fullName).toBeNull();
  });
});

describe("submit-profile status reset", () => {
  // Sanity-level contract test: a returning approved user re-submitting
  // their profile keeps `approved` status. JavaScript is single-threaded
  // and the action loads the principal at the top, so there's no clean
  // way to interleave an approver's UPDATE between principal-load and
  // batch-commit from inside one test. The actual race-fix coverage is
  // the SQL-primitive test below — together they show:
  //   (a) end-to-end: approved + resubmit = still approved
  //   (b) primitive: the WHERE-guarded UPDATE no-ops on an approved row
  it("approved user re-submitting without a profile keeps approved status", async () => {
    const userId = await seedUser({
      email: TEST_EMAIL,
      status: "approved",
    });
    await signInAs(userId);

    await submitProfileAction(validProfile);

    const after = await getDb().query.users.findFirst({
      where: (u, { eq }) => eq(u.id, userId),
    });
    expect(after!.status).toBe("approved");
  });

  it("pending user re-submitting profile stays pending", async () => {
    const userId = await seedUser({
      email: TEST_EMAIL,
      status: "pending",
    });
    await signInAs(userId);

    await submitProfileAction(validProfile);

    const after = await getDb().query.users.findFirst({
      where: (u, { eq }) => eq(u.id, userId),
    });
    expect(after!.status).toBe("pending");
  });

  it("WHERE-guarded UPDATE no-ops on an approved row (race-fix primitive)", async () => {
    // Direct exercise of the SQL guard `submitProfileAction` relies on.
    // Models the production race: an approver flips `users.status` to
    // "approved" between the action's `loadCurrentPrincipal` and its
    // batch commit. Without the WHERE clause, the unconditional
    // `SET status = 'pending'` would revert the approver's decision;
    // with it, the UPDATE matches zero rows and the approval survives.
    const userId = await seedUser({
      email: TEST_EMAIL,
      status: "approved",
    });

    const updated = await getDb()
      .update(schema.users)
      .set({ status: "pending" })
      .where(
        drizzleAnd(
          drizzleEq(schema.users.id, userId),
          drizzleNe(schema.users.status, "approved"),
        ),
      )
      .returning({ id: schema.users.id });

    // Guard fired — zero rows touched.
    expect(updated).toHaveLength(0);

    const after = await getDb().query.users.findFirst({
      where: (u, { eq }) => eq(u.id, userId),
    });
    expect(after!.status).toBe("approved");
  });
});

describe("unclaimed claim flow", () => {
  // Officer-pre-added users have status="unclaimed", a populated
  // placeholderName + unclaimedAt, and a primary email row with
  // verifiedAt=NULL. When the real person clicks their first magic
  // link, the consume handler should stamp verifiedAt and open a
  // session — and on profile submit, the row should auto-approve and
  // NULL the placeholder columns. The audit log must record
  // member.claimed.

  async function seedUnclaimed(args: {
    email: string;
    name: string;
  }): Promise<string> {
    const id = `user_${crypto.randomUUID()}`;
    await getDb()
      .insert(schema.users)
      .values({
        id,
        publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        status: "unclaimed",
        placeholderName: args.name,
        unclaimedAt: new Date(),
      });
    await getDb()
      .insert(schema.userEmails)
      .values({
        id: `uem_${crypto.randomUUID()}`,
        userId: id,
        email: args.email,
        isPrimary: true,
        verifiedAt: null,
      });
    return id;
  }

  it("consume → submit profile auto-approves and clears placeholder columns", async () => {
    const preAddedId = await seedUnclaimed({
      email: TEST_EMAIL,
      name: "Officer Picked Name",
    });

    // Consume the magic link — this is the user's first round-trip to
    // the on-file address, so the consume handler stamps verifiedAt
    // and opens a session.
    const token = await seedMagicLink({
      email: TEST_EMAIL,
      intent: "register",
    });
    const consumeResult = await consumeMagicLinkAction(token);
    expect(consumeResult).toMatchObject({
      ok: true,
      mode: "session",
      status: "unclaimed",
      hasProfile: false,
    });

    // verifiedAt should now be stamped on the primary email.
    const emailAfterConsume = await getDb().query.userEmails.findFirst({
      where: drizzleEq(schema.userEmails.userId, preAddedId),
    });
    expect(emailAfterConsume?.verifiedAt).toBeInstanceOf(Date);

    // Status hasn't flipped yet — that happens at profile submit.
    const userBeforeSubmit = await getDb().query.users.findFirst({
      where: drizzleEq(schema.users.id, preAddedId),
    });
    expect(userBeforeSubmit?.status).toBe("unclaimed");

    // Submit the profile.
    await submitProfileAction(validProfile);

    // Status flips to approved, placeholder columns cleared, profile
    // row created, audit recorded.
    const userAfterSubmit = await getDb().query.users.findFirst({
      where: drizzleEq(schema.users.id, preAddedId),
    });
    expect(userAfterSubmit?.status).toBe("approved");
    expect(userAfterSubmit?.placeholderName).toBeNull();
    expect(userAfterSubmit?.unclaimedAt).toBeNull();
    expect(userAfterSubmit?.approvedAt).toBeInstanceOf(Date);

    const profile = await getDb().query.profiles.findFirst({
      where: (p, { eq }) => eq(p.userId, preAddedId),
    });
    expect(profile?.fullName).toBe("Alice Smith");

    const claimEvents = await getDb()
      .select()
      .from(schema.auditLog)
      .where(drizzleEq(schema.auditLog.action, "member.claimed"));
    const ourClaim = claimEvents.find((e) => e.targetUserId === preAddedId);
    expect(ourClaim).toBeDefined();
    expect(ourClaim?.actorUserId).toBe(preAddedId);
  });

  it("the same email cannot be hijacked by a stranger pre-add (UNIQUE blocks duplicate)", async () => {
    await seedUnclaimed({
      email: TEST_EMAIL,
      name: "First",
    });
    // Another insert against the same address must fail at the
    // user_emails UNIQUE boundary.
    await expect(
      getDb()
        .insert(schema.userEmails)
        .values({
          id: `uem_${crypto.randomUUID()}`,
          userId: `user_${crypto.randomUUID()}`,
          email: TEST_EMAIL,
          isPrimary: true,
          verifiedAt: null,
        }),
    ).rejects.toThrow();
  });
});

describe("pre-seeded user registration", () => {
  it("reuses a pre-seeded email-only row instead of creating a duplicate", async () => {
    // Pre-seed a user with just an email (no profile).
    const preSeededId = await seedUser({
      email: TEST_EMAIL,
      status: "pending",
    });

    // Simulate magic-link registration: consume token → proof cookie.
    const token = await seedMagicLink({
      email: TEST_EMAIL,
      intent: "register",
    });
    await consumeMagicLinkAction(token);

    // Submit profile using proof cookie.
    await submitProfileAction(validProfile);

    // Verify: the SAME user ID was reused (not a new row). Email
    // ownership lives on user_emails; the recovered userId must equal
    // the pre-seeded one.
    const emailRows = await getDb()
      .select()
      .from(schema.userEmails)
      .where(drizzleEq(schema.userEmails.email, TEST_EMAIL));
    expect(emailRows).toHaveLength(1);
    expect(emailRows[0].userId).toBe(preSeededId);

    // Profile attached to the pre-seeded user.
    const profile = await getDb().query.profiles.findFirst({
      where: (p, { eq }) => eq(p.userId, preSeededId),
    });
    expect(profile!.fullName).toBe("Alice Smith");
  });
});
