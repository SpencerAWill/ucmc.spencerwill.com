/**
 * Integration tests for multi-step auth flows. Each test exercises a
 * real sequence of action calls (not individual functions in isolation)
 * against a Miniflare-simulated D1, verifying the end-to-end state
 * transitions.
 *
 * Same mock strategy as server-fns.test.ts: cookie jar for session/proof
 * cookies, rate-limit stubs always-allow, turnstile stub always-pass.
 */
import { eq as drizzleEq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";

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

vi.mock("#/server/turnstile.server", () => ({
  verifyTurnstile: async () => true,
}));

// ── imports (after mocks) ───────────────────────────────────────────────

const {
  requestMagicLinkAction,
  consumeMagicLinkAction,
  submitProfileAction,
  getSessionAction,
  signOutAction,
} = await import("#/server/auth/magic-link-actions.server");
const { MAGIC_LINK_TTL_MS } = await import("#/server/auth/magic-link.server");
const {
  approveRegistrationsAction,
  rejectRegistrationsAction,
  listPendingRegistrationsAction,
} = await import("#/server/auth/member-actions.server");
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
      email: args.email,
      status: args.status ?? "pending",
    });
  if (args.withProfile) {
    await getDb().insert(schema.profiles).values({
      userId: id,
      fullName: "Test User",
      preferredName: "Test",
      mNumber: "",
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
  // Grant system_admin role (has registrations:approve permission).
  await getDb().insert(schema.roles).values({
    id: "role_system_admin",
    name: "system_admin",
    description: "System administrator",
  });
  await getDb().insert(schema.permissions).values({
    id: "perm_registrations_approve",
    name: "registrations:approve",
    description: "Approve registrations",
  });
  await getDb().insert(schema.rolePermissions).values({
    roleId: "role_system_admin",
    permissionId: "perm_registrations_approve",
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
  mNumber: "M12345678",
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
    const user = await getDb().query.users.findFirst({
      where: (u, { eq }) => eq(u.email, TEST_EMAIL),
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
    expect(principal!.email).toBe(TEST_EMAIL);
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

  it("throws when caller lacks registrations:approve permission", async () => {
    const regularUser = await seedUser({
      email: "member@example.com",
      status: "approved",
      withProfile: true,
    });
    await signInAs(regularUser);

    await expect(approveRegistrationsAction(["some_user_id"])).rejects.toThrow(
      "registrations:approve",
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

    // Verify: the SAME user ID was reused (not a new row).
    const users = await getDb()
      .select()
      .from(schema.users)
      .where(drizzleEq(schema.users.email, TEST_EMAIL));
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(preSeededId);

    // Profile attached to the pre-seeded user.
    const profile = await getDb().query.profiles.findFirst({
      where: (p, { eq }) => eq(p.userId, preSeededId),
    });
    expect(profile!.fullName).toBe("Alice Smith");
  });
});
