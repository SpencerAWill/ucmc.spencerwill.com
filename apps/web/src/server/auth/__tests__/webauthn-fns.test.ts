import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Principal } from "#/server/auth/principal";
import type * as WebauthnModule from "#/server/auth/webauthn";
import { getDb, schema } from "#/server/db";

// ── shared mocks ─────────────────────────────────────────────────────────

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

// `loadCurrentPrincipal` is the auth gate we swap per-test — simpler
// than seeding a real sessions row + a matching cookie.
let currentPrincipal: Principal | null = null;
const openSessionSpy = vi.fn();
const rotateSessionSpy = vi.fn();
vi.mock("#/server/auth/session", () => ({
  loadCurrentPrincipal: async () => currentPrincipal,
  openSession: async (userId: string) => {
    openSessionSpy(userId);
  },
  rotateSession: async (userId: string) => {
    rotateSessionSpy(userId);
  },
  closeSession: async () => {},
}));

// The simplewebauthn wrapper is mocked wholesale so tests don't have to
// produce real signed attestation/assertion payloads. The state-machine
// around it is what we're verifying.
const buildRegistrationOptionsResult: PublicKeyCredentialCreationOptionsJSON = {
  challenge: "reg-challenge",
  rp: { id: "localhost", name: "UCMC" },
  user: { id: "u", name: "u", displayName: "u" },
  pubKeyCredParams: [],
};
const buildAuthenticationOptionsResult: PublicKeyCredentialRequestOptionsJSON =
  {
    challenge: "auth-challenge",
    rpId: "localhost",
  };
let verifyRegistrationResult = {
  verified: true,
  registrationInfo: {
    credential: {
      id: "cred-id-1",
      publicKey: new Uint8Array([1, 2, 3, 4]),
      counter: 0,
    },
  },
};
let verifyAuthenticationResult = {
  verified: true,
  authenticationInfo: { newCounter: 1 },
};
vi.mock("#/server/auth/webauthn", async () => {
  const actual = await vi.importActual<typeof WebauthnModule>(
    "#/server/auth/webauthn",
  );
  return {
    ...actual,
    buildRegistrationOptions: vi.fn(async () => buildRegistrationOptionsResult),
    buildAuthenticationOptions: vi.fn(
      async () => buildAuthenticationOptionsResult,
    ),
    verifyRegistration: vi.fn(async () => verifyRegistrationResult),
    verifyAuthentication: vi.fn(async () => verifyAuthenticationResult),
  };
});

const { putChallenge, getChallenge } =
  await import("#/server/auth/webauthn-challenge");
const {
  webauthnRegisterBeginAction,
  webauthnRegisterFinishAction,
  webauthnAuthenticateBeginAction,
  webauthnAuthenticateFinishAction,
  removePasskeyAction,
  listPasskeysAction,
} = await import("#/server/auth/webauthn-fns");
const { insertCredential, listCredentialsForUser } =
  await import("#/server/auth/passkey-credentials");

// ── helpers ──────────────────────────────────────────────────────────────

function makePrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: "user_abc",
    email: "member@example.com",
    status: "approved",
    hasProfile: true,
    roles: [],
    permissions: [],
    ...overrides,
  };
}

async function seedUser(args: {
  id: string;
  email: string;
  status?: schema.UserStatus;
  withProfile?: boolean;
}): Promise<void> {
  await getDb()
    .insert(schema.users)
    .values({
      id: args.id,
      email: args.email,
      status: args.status ?? "approved",
    });
  if (args.withProfile) {
    await getDb().insert(schema.profiles).values({
      userId: args.id,
      fullName: "Test",
      preferredName: "Test",
      mNumber: "",
      phone: "+15135551212",
      emergencyContactName: "EC",
      emergencyContactPhone: "+15135551213",
      ucAffiliation: "student",
      updatedAt: new Date(),
    });
  }
}

beforeEach(async () => {
  cookieJar.clear();
  rateLimitAllowed = true;
  currentPrincipal = null;
  openSessionSpy.mockReset();
  rotateSessionSpy.mockReset();
  verifyRegistrationResult = {
    verified: true,
    registrationInfo: {
      credential: {
        id: "cred-id-1",
        publicKey: new Uint8Array([1, 2, 3, 4]),
        counter: 0,
      },
    },
  };
  verifyAuthenticationResult = {
    verified: true,
    authenticationInfo: { newCounter: 1 },
  };

  const db = getDb();
  await db.delete(schema.sessions);
  await db.delete(schema.passkeyCredentials);
  await db.delete(schema.profiles);
  await db.delete(schema.magicLinks);
  await db.delete(schema.users);
});

// ── register ─────────────────────────────────────────────────────────────

describe("webauthnRegisterBeginAction", () => {
  it("rejects unauthorized callers", async () => {
    const result = await webauthnRegisterBeginAction();
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("issues options and stashes the challenge in KV for a signed-in user", async () => {
    currentPrincipal = makePrincipal();
    const result = await webauthnRegisterBeginAction();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const ceremonyCookieKey = [...cookieJar.keys()].find((k) =>
      k.endsWith("ucmc_webauthn"),
    );
    expect(ceremonyCookieKey).toBeDefined();
    const ceremonyId = cookieJar.get(ceremonyCookieKey!)!;

    const stored = await getChallenge(ceremonyId);
    expect(stored).toEqual({
      challenge: "reg-challenge",
      type: "register",
      userId: currentPrincipal.userId,
    });
  });

  it("is rate-limited by IP", async () => {
    currentPrincipal = makePrincipal();
    rateLimitAllowed = false;
    const result = await webauthnRegisterBeginAction();
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
  });
});

describe("webauthnRegisterFinishAction", () => {
  const response = {
    id: "cred-id-1",
    rawId: "cred-id-1",
    type: "public-key",
    response: { transports: ["internal"] },
    clientExtensionResults: {},
  } as unknown as RegistrationResponseJSON;

  it("rejects when there is no ceremony cookie", async () => {
    currentPrincipal = makePrincipal();
    const result = await webauthnRegisterFinishAction({ response });
    expect(result).toEqual({ ok: false, reason: "no_ceremony" });
  });

  it("rejects when the ceremony userId doesn't match the session", async () => {
    currentPrincipal = makePrincipal();
    // Seed a ceremony that belongs to a DIFFERENT user.
    const ceremonyId = "ceremony-1";
    await putChallenge(ceremonyId, {
      challenge: "reg-challenge",
      type: "register",
      userId: "someone-else",
    });
    cookieJar.set("ucmc_webauthn", ceremonyId);

    const result = await webauthnRegisterFinishAction({ response });
    expect(result).toEqual({ ok: false, reason: "verification_failed" });

    // Cookie cleared, challenge deleted, nothing inserted.
    expect(await getChallenge(ceremonyId)).toBeNull();
    const saved = await listCredentialsForUser(currentPrincipal.userId);
    expect(saved).toEqual([]);
  });

  it("persists the credential and rotates the session on success", async () => {
    currentPrincipal = makePrincipal();
    await seedUser({
      id: currentPrincipal.userId,
      email: currentPrincipal.email,
      status: "approved",
      withProfile: true,
    });
    const ceremonyId = "ceremony-2";
    await putChallenge(ceremonyId, {
      challenge: "reg-challenge",
      type: "register",
      userId: currentPrincipal.userId,
    });
    cookieJar.set("ucmc_webauthn", ceremonyId);

    const result = await webauthnRegisterFinishAction({
      response,
      nickname: "My iPhone",
    });
    expect(result).toEqual({ ok: true, credentialId: "cred-id-1" });
    expect(rotateSessionSpy).toHaveBeenCalledWith(currentPrincipal.userId);

    const saved = await listCredentialsForUser(currentPrincipal.userId);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.credentialId).toBe("cred-id-1");
    expect(saved[0]?.nickname).toBe("My iPhone");

    // Ceremony is single-use.
    expect(await getChallenge(ceremonyId)).toBeNull();
  });

  it("rejects when simplewebauthn verification fails", async () => {
    currentPrincipal = makePrincipal();
    verifyRegistrationResult = {
      verified: false,
    } as typeof verifyRegistrationResult;
    const ceremonyId = "ceremony-3";
    await putChallenge(ceremonyId, {
      challenge: "reg-challenge",
      type: "register",
      userId: currentPrincipal.userId,
    });
    cookieJar.set("ucmc_webauthn", ceremonyId);

    const result = await webauthnRegisterFinishAction({ response });
    expect(result).toEqual({ ok: false, reason: "verification_failed" });
  });
});

// ── authenticate ─────────────────────────────────────────────────────────

describe("webauthnAuthenticateBeginAction", () => {
  it("returns discoverable options without any identifier input", async () => {
    const result = await webauthnAuthenticateBeginAction();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.options.challenge).toBe("auth-challenge");

    const ceremonyCookieKey = [...cookieJar.keys()].find((k) =>
      k.endsWith("ucmc_webauthn"),
    );
    expect(ceremonyCookieKey).toBeDefined();
    const ceremonyId = cookieJar.get(ceremonyCookieKey!)!;
    expect(await getChallenge(ceremonyId)).toEqual({
      challenge: "auth-challenge",
      type: "authenticate",
    });
  });

  it("is rate-limited before touching KV", async () => {
    rateLimitAllowed = false;
    const result = await webauthnAuthenticateBeginAction();
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(cookieJar.size).toBe(0);
  });
});

describe("webauthnAuthenticateFinishAction", () => {
  const response = {
    id: "cred-id-1",
    rawId: "cred-id-1",
    type: "public-key",
    response: {},
    clientExtensionResults: {},
  } as unknown as AuthenticationResponseJSON;

  it("rejects when there is no ceremony cookie", async () => {
    const result = await webauthnAuthenticateFinishAction({ response });
    expect(result).toEqual({ ok: false, reason: "no_ceremony" });
  });

  it("rejects an unknown credential id with a generic 'invalid'", async () => {
    const ceremonyId = "ceremony-auth-1";
    await putChallenge(ceremonyId, {
      challenge: "auth-challenge",
      type: "authenticate",
    });
    cookieJar.set("ucmc_webauthn", ceremonyId);

    const result = await webauthnAuthenticateFinishAction({ response });
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(openSessionSpy).not.toHaveBeenCalled();
  });

  it("rejects when the sign counter regresses", async () => {
    const userId = "user_counter_regression";
    await seedUser({
      id: userId,
      email: "cr@example.com",
      status: "approved",
      withProfile: true,
    });
    await insertCredential({
      userId,
      credentialId: "cred-id-1",
      publicKey: new Uint8Array([1, 2, 3]),
      // Stored counter is 5; the authenticator reports 3 → regression.
      counter: 5,
    });
    verifyAuthenticationResult = {
      verified: true,
      authenticationInfo: { newCounter: 3 },
    };

    const ceremonyId = "ceremony-auth-2";
    await putChallenge(ceremonyId, {
      challenge: "auth-challenge",
      type: "authenticate",
    });
    cookieJar.set("ucmc_webauthn", ceremonyId);

    const result = await webauthnAuthenticateFinishAction({ response });
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(openSessionSpy).not.toHaveBeenCalled();
  });

  it("opens a session and reports principal state on success", async () => {
    const userId = "user_happy_path";
    await seedUser({
      id: userId,
      email: "happy@example.com",
      status: "approved",
      withProfile: true,
    });
    await insertCredential({
      userId,
      credentialId: "cred-id-1",
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 0,
    });

    const ceremonyId = "ceremony-auth-3";
    await putChallenge(ceremonyId, {
      challenge: "auth-challenge",
      type: "authenticate",
    });
    cookieJar.set("ucmc_webauthn", ceremonyId);

    const result = await webauthnAuthenticateFinishAction({ response });
    expect(result).toEqual({
      ok: true,
      status: "approved",
      hasProfile: true,
    });
    expect(openSessionSpy).toHaveBeenCalledWith(userId);

    // Ceremony cleared and consumed.
    expect(await getChallenge(ceremonyId)).toBeNull();
    const ceremonyCookie = [...cookieJar.keys()].find((k) =>
      k.endsWith("ucmc_webauthn"),
    );
    expect(ceremonyCookie).toBeUndefined();
  });
});

// ── remove ───────────────────────────────────────────────────────────────

describe("removePasskeyAction", () => {
  it("rejects unauthorized callers", async () => {
    const result = await removePasskeyAction({ credentialId: "cred-id-1" });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("only deletes a credential owned by the caller", async () => {
    const ownerId = "user_owner";
    const thiefId = "user_thief";
    await seedUser({ id: ownerId, email: "owner@example.com" });
    await seedUser({ id: thiefId, email: "thief@example.com" });
    await insertCredential({
      userId: ownerId,
      credentialId: "cred-id-1",
      publicKey: new Uint8Array([1]),
      counter: 0,
    });

    currentPrincipal = makePrincipal({
      userId: thiefId,
      email: "thief@example.com",
    });
    const result = await removePasskeyAction({ credentialId: "cred-id-1" });
    expect(result).toEqual({ ok: false, reason: "not_found" });

    // Still there for the real owner.
    const owned = await listCredentialsForUser(ownerId);
    expect(owned).toHaveLength(1);
  });

  it("removes the credential when called by its owner", async () => {
    const userId = "user_rm";
    await seedUser({ id: userId, email: "rm@example.com" });
    await insertCredential({
      userId,
      credentialId: "cred-id-1",
      publicKey: new Uint8Array([1]),
      counter: 0,
    });

    currentPrincipal = makePrincipal({ userId, email: "rm@example.com" });
    const result = await removePasskeyAction({ credentialId: "cred-id-1" });
    expect(result).toEqual({ ok: true });

    expect(await listCredentialsForUser(userId)).toEqual([]);
  });
});

describe("listPasskeysAction", () => {
  it("returns empty for anonymous callers", async () => {
    const result = await listPasskeysAction();
    expect(result).toEqual({ ok: false, passkeys: [] });
  });

  it("lists only the caller's passkeys", async () => {
    const meId = "user_me";
    const otherId = "user_other";
    await seedUser({ id: meId, email: "me@example.com" });
    await seedUser({ id: otherId, email: "other@example.com" });
    await insertCredential({
      userId: meId,
      credentialId: "mine",
      publicKey: new Uint8Array([1]),
      counter: 0,
      nickname: "iPhone",
    });
    await insertCredential({
      userId: otherId,
      credentialId: "theirs",
      publicKey: new Uint8Array([2]),
      counter: 0,
    });

    currentPrincipal = makePrincipal({ userId: meId, email: "me@example.com" });
    const result = await listPasskeysAction();
    expect(result.ok).toBe(true);
    expect(result.passkeys.map((p) => p.credentialId)).toEqual(["mine"]);
    expect(result.passkeys[0]?.nickname).toBe("iPhone");
  });
});
