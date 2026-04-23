/**
 * TanStack Start server functions for passkey (WebAuthn) enrollment +
 * authentication. Each pair (begin/finish) shares a ceremony cookie +
 * KV-stored challenge; the finish call verifies the browser's response
 * and, on success, opens or rotates a session.
 *
 * Five server fns:
 *   - webauthnRegisterBegin  (session-gated)
 *   - webauthnRegisterFinish (session-gated)
 *   - webauthnAuthenticateBegin  (public; rate-limited)
 *   - webauthnAuthenticateFinish (public; rate-limited)
 *   - removePasskey (session-gated)
 *
 * Every handler body is extracted into a plain `*Action` function so
 * tests can exercise it directly — TanStack Start's server-fn callable
 * stubs to undefined under vitest-pool-workers.
 */
import { createServerFn } from "@tanstack/react-start";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { z } from "zod";

import {
  deleteCredentialForUser,
  findCredentialByCredentialId,
  insertCredential,
  listCredentialsForUser,
  updateCredentialCounter,
} from "#/server/auth/passkey-credentials";
import { loadPrincipal } from "#/server/auth/principal";
import type { Principal } from "#/server/auth/principal";
import {
  loadCurrentPrincipal,
  openSession,
  rotateSession,
} from "#/server/auth/session";
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "#/server/auth/webauthn";
import {
  clearCeremonyCookie,
  readCeremonyCookie,
  writeCeremonyCookie,
} from "#/server/auth/webauthn-ceremony.server";
import {
  deleteChallenge,
  getChallenge,
  newCeremonyId,
  putChallenge,
} from "#/server/auth/webauthn-challenge";
import type { schema } from "#/server/db";
import { checkAuthRateLimitByIp } from "#/server/rate-limit.server";

// ── types ────────────────────────────────────────────────────────────────

export type RegisterBeginResult =
  | { ok: true; options: PublicKeyCredentialCreationOptionsJSON }
  | { ok: false; reason: "unauthorized" | "rate_limited" };

export type RegisterFinishResult =
  | { ok: true; credentialId: string }
  | {
      ok: false;
      reason:
        | "unauthorized"
        | "rate_limited"
        | "no_ceremony"
        | "verification_failed";
    };

export type AuthenticateBeginResult =
  | { ok: true; options: PublicKeyCredentialRequestOptionsJSON }
  | { ok: false; reason: "rate_limited" };

export type AuthenticateFinishResult =
  | {
      ok: true;
      status: schema.UserStatus;
      hasProfile: boolean;
    }
  | {
      ok: false;
      reason: "rate_limited" | "no_ceremony" | "invalid";
    };

export type RemovePasskeyResult =
  | { ok: true }
  | { ok: false; reason: "unauthorized" | "not_found" };

// ── register (session-gated) ─────────────────────────────────────────────

export async function webauthnRegisterBeginAction(): Promise<RegisterBeginResult> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    return { ok: false, reason: "unauthorized" };
  }
  if (!(await checkAuthRateLimitByIp())) {
    return { ok: false, reason: "rate_limited" };
  }

  const existing = await listCredentialsForUser(principal.userId);
  const options = await buildRegistrationOptions(
    { id: principal.userId, email: principal.email },
    existing.map((c) => c.credentialId),
  );

  const ceremonyId = newCeremonyId();
  await putChallenge(ceremonyId, {
    challenge: options.challenge,
    type: "register",
    userId: principal.userId,
  });
  writeCeremonyCookie(ceremonyId);

  return { ok: true, options };
}

export async function webauthnRegisterFinishAction(args: {
  response: RegistrationResponseJSON;
  nickname?: string;
}): Promise<RegisterFinishResult> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    return { ok: false, reason: "unauthorized" };
  }
  if (!(await checkAuthRateLimitByIp())) {
    return { ok: false, reason: "rate_limited" };
  }

  const ceremonyId = readCeremonyCookie();
  if (!ceremonyId) {
    return { ok: false, reason: "no_ceremony" };
  }
  const stored = await getChallenge(ceremonyId);
  // Single-use challenge: delete before any further work so even a crash
  // path can't let the same challenge be retried.
  await deleteChallenge(ceremonyId);
  clearCeremonyCookie();

  if (
    !stored ||
    stored.type !== "register" ||
    stored.userId !== principal.userId
  ) {
    return { ok: false, reason: "verification_failed" };
  }

  let verification;
  try {
    verification = await verifyRegistration({
      response: args.response,
      expectedChallenge: stored.challenge,
    });
  } catch {
    return { ok: false, reason: "verification_failed" };
  }

  if (!verification.verified) {
    return { ok: false, reason: "verification_failed" };
  }

  const info = verification.registrationInfo;
  await insertCredential({
    userId: principal.userId,
    credentialId: info.credential.id,
    publicKey: info.credential.publicKey,
    counter: info.credential.counter,
    transports: args.response.response.transports,
    nickname: args.nickname,
  });

  // Privilege boundary — replace the cookie so a stolen pre-enrollment
  // session ID can't be used post-enrollment.
  await rotateSession(principal.userId);

  return { ok: true, credentialId: info.credential.id };
}

// ── authenticate (public) ────────────────────────────────────────────────

export async function webauthnAuthenticateBeginAction(): Promise<AuthenticateBeginResult> {
  if (!(await checkAuthRateLimitByIp())) {
    return { ok: false, reason: "rate_limited" };
  }

  const options = await buildAuthenticationOptions();
  const ceremonyId = newCeremonyId();
  await putChallenge(ceremonyId, {
    challenge: options.challenge,
    type: "authenticate",
  });
  writeCeremonyCookie(ceremonyId);

  return { ok: true, options };
}

export async function webauthnAuthenticateFinishAction(args: {
  response: AuthenticationResponseJSON;
}): Promise<AuthenticateFinishResult> {
  if (!(await checkAuthRateLimitByIp())) {
    return { ok: false, reason: "rate_limited" };
  }

  const ceremonyId = readCeremonyCookie();
  if (!ceremonyId) {
    return { ok: false, reason: "no_ceremony" };
  }
  const stored = await getChallenge(ceremonyId);
  await deleteChallenge(ceremonyId);
  clearCeremonyCookie();

  if (!stored || stored.type !== "authenticate") {
    return { ok: false, reason: "invalid" };
  }

  const credential = await findCredentialByCredentialId(args.response.id);
  if (!credential) {
    return { ok: false, reason: "invalid" };
  }

  let verification;
  try {
    verification = await verifyAuthentication({
      response: args.response,
      expectedChallenge: stored.challenge,
      credentialPublicKey: credential.publicKey,
      credentialID: credential.credentialId,
      counter: credential.counter,
      transports: credential.transports,
    });
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (!verification.verified) {
    return { ok: false, reason: "invalid" };
  }

  // Counter regression ⇒ possible cloned authenticator. Modern passkeys
  // report 0 and never increment; accept 0 but reject actual regressions.
  const newCounter = verification.authenticationInfo.newCounter;
  if (newCounter !== 0 && newCounter <= credential.counter) {
    return { ok: false, reason: "invalid" };
  }

  await updateCredentialCounter({
    credentialId: credential.credentialId,
    counter: newCounter,
  });

  // Re-derive principal state so the client can route to the right
  // landing page — mirrors the /auth/callback decision table without
  // requiring a second round trip.
  const principal = await loadPrincipal(credential.userId);
  if (!principal) {
    // Credential row pointed at a user that no longer exists. Treat as
    // generic invalid to avoid leaking state.
    return { ok: false, reason: "invalid" };
  }

  await openSession(principal.userId);

  return {
    ok: true,
    status: principal.status,
    hasProfile: principalHasProfile(principal),
  };
}

function principalHasProfile(p: Principal): boolean {
  return p.hasProfile;
}

// ── remove (session-gated) ───────────────────────────────────────────────

export async function removePasskeyAction(args: {
  credentialId: string;
}): Promise<RemovePasskeyResult> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    return { ok: false, reason: "unauthorized" };
  }
  const deleted = await deleteCredentialForUser({
    userId: principal.userId,
    credentialId: args.credentialId,
  });
  if (!deleted) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true };
}

// ── server-fn wrappers ───────────────────────────────────────────────────

export const webauthnRegisterBeginFn = createServerFn({
  method: "POST",
}).handler(async () => webauthnRegisterBeginAction());

// `response` is the JSON payload @simplewebauthn/browser's
// startRegistration returns. We accept it as an opaque record and hand
// it to verifyRegistrationResponse, which does the actual schema check.
const registerFinishInput = z.object({
  response: z.unknown(),
  nickname: z.string().trim().max(60).optional(),
});

export const webauthnRegisterFinishFn = createServerFn({ method: "POST" })
  .inputValidator(registerFinishInput)
  .handler(async ({ data }) =>
    webauthnRegisterFinishAction({
      response: data.response as RegistrationResponseJSON,
      nickname: data.nickname,
    }),
  );

export const webauthnAuthenticateBeginFn = createServerFn({
  method: "POST",
}).handler(async () => webauthnAuthenticateBeginAction());

const authenticateFinishInput = z.object({
  response: z.unknown(),
});

export const webauthnAuthenticateFinishFn = createServerFn({ method: "POST" })
  .inputValidator(authenticateFinishInput)
  .handler(async ({ data }) =>
    webauthnAuthenticateFinishAction({
      response: data.response as AuthenticationResponseJSON,
    }),
  );

const removePasskeyInput = z.object({
  credentialId: z.string().min(1).max(512),
});

export const removePasskeyFn = createServerFn({ method: "POST" })
  .inputValidator(removePasskeyInput)
  .handler(async ({ data }) =>
    removePasskeyAction({ credentialId: data.credentialId }),
  );

// ── listing (session-gated GET) ──────────────────────────────────────────

export interface PasskeySummary {
  credentialId: string;
  nickname: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listPasskeysAction(): Promise<{
  ok: boolean;
  passkeys: PasskeySummary[];
}> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    return { ok: false, passkeys: [] };
  }
  const rows = await listCredentialsForUser(principal.userId);
  return {
    ok: true,
    passkeys: rows.map((r) => ({
      credentialId: r.credentialId,
      nickname: r.nickname,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    })),
  };
}

export const listPasskeysFn = createServerFn({ method: "GET" }).handler(
  async () => listPasskeysAction(),
);
