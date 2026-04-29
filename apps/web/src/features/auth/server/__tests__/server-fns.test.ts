import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";

// Cookie and request-header helpers from @tanstack/react-start/server
// normally need an active H3 event context (the SSR runtime sets one up
// per request). Tests don't run inside an HTTP request, so we replace
// them with a tiny in-memory cookie jar + a stub header reader.
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

// Rate limiting is its own layer with its own tests; here we just need
// to flip the allow/deny decision per test. The real limiter binding is
// exercised by the deployed Worker, not by unit tests.
let rateLimitAllowed = true;
vi.mock("#/server/rate-limit.server", () => ({
  checkAuthRateLimitByIp: async () => rateLimitAllowed,
  checkAuthRateLimitByEmail: async () => rateLimitAllowed,
  checkHealthRateLimit: async () => rateLimitAllowed,
}));

// Import AFTER the mocks above so the action module picks them up.
const {
  consumeMagicLinkAction,
  getProfileAction,
  submitDetailsAction,
  submitPublicProfileAction,
} = await import("#/features/auth/server/magic-link-actions.server");
const { BIO_LIMITS, profileInputSchema } =
  await import("#/server/profile/profile-schemas");
const { MAGIC_LINK_TTL_MS } =
  await import("#/features/auth/server/magic-link.server");
const { openSession } = await import("#/server/auth/session.server");

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
      email: args.email,
      status: args.status ?? "pending",
    });
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

beforeEach(async () => {
  cookieJar.clear();
  rateLimitAllowed = true;
  // Per-test reset: D1 is shared across the file in singleWorker mode,
  // so wipe auth tables between tests to keep each case independent.
  const db = getDb();
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.magicLinks);
  await db.delete(schema.users);
});

describe("consumeMagicLinkAction", () => {
  it("returns rate_limited when the IP limiter rejects", async () => {
    rateLimitAllowed = false;
    const token = await seedMagicLink({
      email: "nobody@example.com",
      intent: "register",
    });

    const result = await consumeMagicLinkAction(token);

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    // Nothing should have been consumed.
    const row = await getDb().query.magicLinks.findFirst();
    expect(row?.consumedAt).toBeNull();
  });

  it("returns invalid for an unknown token", async () => {
    const result = await consumeMagicLinkAction(
      "not-a-real-token-abcdefg1234567",
    );
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("issues a proof cookie (mode: proof) for a brand-new email", async () => {
    const token = await seedMagicLink({
      email: "newcomer@example.com",
      intent: "register",
    });

    const result = await consumeMagicLinkAction(token);

    expect(result).toEqual({ ok: true, mode: "proof", intent: "register" });
    // Proof cookie was set, session cookie was not.
    const proofCookie = [...cookieJar.keys()].find((k) =>
      k.endsWith("ucmc_proof"),
    );
    const sessionCookie = [...cookieJar.keys()].find((k) =>
      k.endsWith("ucmc_session"),
    );
    expect(proofCookie).toBeDefined();
    expect(sessionCookie).toBeUndefined();
  });

  it("opens a session (mode: session) for a returning approved user with a profile", async () => {
    const email = "member@example.com";
    await seedUser({ email, status: "approved", withProfile: true });
    const token = await seedMagicLink({ email, intent: "login" });

    const result = await consumeMagicLinkAction(token);

    expect(result).toEqual({
      ok: true,
      mode: "session",
      status: "approved",
      hasProfile: true,
    });
    // Session cookie set, proof cookie NOT set.
    const sessionCookie = [...cookieJar.keys()].find((k) =>
      k.endsWith("ucmc_session"),
    );
    const proofCookie = [...cookieJar.keys()].find((k) =>
      k.endsWith("ucmc_proof"),
    );
    expect(sessionCookie).toBeDefined();
    expect(proofCookie).toBeUndefined();
    // And a sessions row was created.
    const sessions = await getDb().select().from(schema.sessions).all();
    expect(sessions).toHaveLength(1);
  });

  it("opens a session and reports hasProfile:false for a user row with no profile", async () => {
    const email = "halfway@example.com";
    await seedUser({ email, status: "pending", withProfile: false });
    const token = await seedMagicLink({ email, intent: "login" });

    const result = await consumeMagicLinkAction(token);

    expect(result).toEqual({
      ok: true,
      mode: "session",
      status: "pending",
      hasProfile: false,
    });
  });

  it("reports status:pending for a returning user who is not yet approved", async () => {
    const email = "pending@example.com";
    await seedUser({ email, status: "pending", withProfile: true });
    const token = await seedMagicLink({ email, intent: "login" });

    const result = await consumeMagicLinkAction(token);

    expect(result).toMatchObject({
      ok: true,
      mode: "session",
      status: "pending",
      hasProfile: true,
    });
  });

  it("refuses to consume an expired token", async () => {
    const token = await seedMagicLink({
      email: "stale@example.com",
      intent: "register",
      // Explicitly set expiry in the past.
      expiresAt: new Date(Date.now() - 1_000),
    });

    const result = await consumeMagicLinkAction(token);

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses to re-consume an already-used token", async () => {
    const email = "replay@example.com";
    const token = await seedMagicLink({ email, intent: "register" });

    const first = await consumeMagicLinkAction(token);
    expect(first.ok).toBe(true);

    const second = await consumeMagicLinkAction(token);
    expect(second).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("getProfileAction", () => {
  it("returns { profile: null } for anonymous callers", async () => {
    const result = await getProfileAction();
    expect(result).toEqual({ profile: null, emergencyContacts: [] });
  });

  it("returns { profile: null } for a signed-in user without a profile row", async () => {
    const email = "nopro@example.com";
    const userId = await seedUser({ email, status: "pending" });
    await openSession(userId);

    const result = await getProfileAction();
    expect(result).toEqual({ profile: null, emergencyContacts: [] });
  });

  it("returns the signed-in user's profile row when one exists", async () => {
    const email = "owner@example.com";
    const userId = await seedUser({
      email,
      status: "approved",
      withProfile: true,
    });
    await openSession(userId);

    const result = await getProfileAction();
    expect(result.profile).not.toBeNull();
    expect(result.profile?.userId).toBe(userId);
    expect(result.profile?.fullName).toBe("Test User");
  });

  it("scopes the query to the caller's userId (no IDOR)", async () => {
    // Seed two users, each with a profile. Caller is user A; user B's
    // profile must not leak.
    const aId = await seedUser({
      email: "a@example.com",
      status: "approved",
      withProfile: true,
    });
    await seedUser({
      email: "b@example.com",
      status: "approved",
      withProfile: true,
    });
    await openSession(aId);

    const result = await getProfileAction();
    expect(result.profile?.userId).toBe(aId);
  });
});

describe("submitPublicProfileAction", () => {
  it("rejects anonymous callers", async () => {
    await expect(
      submitPublicProfileAction({
        preferredName: "Pat",
        ucAffiliation: "student",
        bio: "",
      }),
    ).rejects.toThrow();
  });

  it("updates only preferredName + ucAffiliation, leaving private fields intact", async () => {
    const userId = await seedUser({
      email: "pub@example.com",
      status: "approved",
      withProfile: true,
    });
    await openSession(userId);

    await submitPublicProfileAction({
      preferredName: "NewPreferred",
      ucAffiliation: "alum",
      bio: "",
    });

    const row = await getDb().query.profiles.findFirst({
      where: eq(schema.profiles.userId, userId),
    });
    expect(row?.preferredName).toBe("NewPreferred");
    expect(row?.ucAffiliation).toBe("alum");
    // Private columns from seedUser's withProfile defaults must not be
    // touched by a public-profile update.
    expect(row?.fullName).toBe("Test User");
    expect(row?.phone).toBe("+15135551212");
  });

  it("scopes the update to the caller's userId (no IDOR)", async () => {
    const aId = await seedUser({
      email: "a@example.com",
      status: "approved",
      withProfile: true,
    });
    const bId = await seedUser({
      email: "b@example.com",
      status: "approved",
      withProfile: true,
    });
    await openSession(aId);

    await submitPublicProfileAction({
      preferredName: "OnlyA",
      ucAffiliation: "faculty",
      bio: "",
    });

    const bRow = await getDb().query.profiles.findFirst({
      where: eq(schema.profiles.userId, bId),
    });
    expect(bRow?.preferredName).toBe("Test");
    expect(bRow?.ucAffiliation).toBe("student");
  });
});

describe("submitDetailsAction", () => {
  it("rejects anonymous callers", async () => {
    await expect(
      submitDetailsAction({
        fullName: "Real Name",
        phone: "+15135559999",
        emergencyContacts: [],
      }),
    ).rejects.toThrow();
  });

  it("updates private fields, replaces emergency contacts, leaves public fields intact", async () => {
    const userId = await seedUser({
      email: "det@example.com",
      status: "approved",
      withProfile: true,
    });
    await openSession(userId);
    // Seed an existing emergency contact so we can verify replace-on-write.
    await getDb().insert(schema.emergencyContacts).values({
      id: "ec_old",
      userId,
      name: "Old Contact",
      phone: "+15135550000",
      relationship: "friend",
    });

    await submitDetailsAction({
      fullName: "Updated Legal",
      phone: "+15135559999",
      emergencyContacts: [
        {
          name: "New Contact",
          phone: "+15135551111",
          relationship: "parent",
        },
      ],
    });

    const row = await getDb().query.profiles.findFirst({
      where: eq(schema.profiles.userId, userId),
    });
    expect(row?.fullName).toBe("Updated Legal");
    expect(row?.phone).toBe("+15135559999");
    // Public-profile columns must not be clobbered by a details update.
    expect(row?.preferredName).toBe("Test");
    expect(row?.ucAffiliation).toBe("student");

    const contacts = await getDb()
      .select()
      .from(schema.emergencyContacts)
      .where(eq(schema.emergencyContacts.userId, userId));
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.name).toBe("New Contact");
  });

  it("scopes the update to the caller's userId (no IDOR)", async () => {
    const aId = await seedUser({
      email: "a2@example.com",
      status: "approved",
      withProfile: true,
    });
    const bId = await seedUser({
      email: "b2@example.com",
      status: "approved",
      withProfile: true,
    });
    await openSession(aId);

    await submitDetailsAction({
      fullName: "Only A Legal",
      phone: "+15135552222",
      emergencyContacts: [],
    });

    const bRow = await getDb().query.profiles.findFirst({
      where: eq(schema.profiles.userId, bId),
    });
    expect(bRow?.fullName).toBe("Test User");
    expect(bRow?.phone).toBe("+15135551212");
  });
});

describe("profileInputSchema bio", () => {
  function baseInput(bio: string) {
    return {
      fullName: "Test User",
      preferredName: "Test",
      phone: "+15135551212",
      emergencyContacts: [],
      ucAffiliation: "student" as const,
      bio,
      policiesAck: true,
    };
  }

  it("accepts a bio at the word limit", () => {
    const bio = Array.from(
      { length: BIO_LIMITS.maxWords },
      (_, i) => `word${i}`,
    ).join(" ");
    const result = profileInputSchema.safeParse(baseInput(bio));
    expect(result.success).toBe(true);
  });

  it("rejects a bio over the word limit", () => {
    const bio = Array.from(
      { length: BIO_LIMITS.maxWords + 1 },
      (_, i) => `word${i}`,
    ).join(" ");
    const result = profileInputSchema.safeParse(baseInput(bio));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /At most/.test(i.message))).toBe(
        true,
      );
    }
  });

  it("accepts an empty bio", () => {
    const result = profileInputSchema.safeParse(baseInput(""));
    expect(result.success).toBe(true);
  });
});
