/**
 * Action implementations behind the passkey (WebAuthn) server fns. Lives
 * in a `.server.ts` file so module-scope imports of D1, KV, the cookie
 * helpers, and the rate-limit binding stay off the client module graph
 * — the shell in `./webauthn-fns.ts` loads this via dynamic import
 * inside each createServerFn handler.
 *
 * Tests exercise these action functions directly.
 */
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

import {
  deleteCredentialForUser,
  findCredentialByCredentialId,
  insertCredential,
  listCredentialsForUser,
  updateCredentialCounter,
} from "#/features/auth/server/passkey-credentials.server";
import { loadPrincipal } from "#/features/auth/server/principal.server";
import {
  loadCurrentPrincipal,
  openSession,
  rotateSession,
} from "#/features/auth/server/session.server";
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "#/features/auth/server/webauthn.server";
import {
  clearCeremonyCookie,
  readCeremonyCookie,
  writeCeremonyCookie,
} from "#/features/auth/server/webauthn-ceremony.server";
import {
  deleteChallenge,
  getChallenge,
  newCeremonyId,
  putChallenge,
} from "#/features/auth/server/webauthn-challenge.server";
import type {
  AuthenticateBeginResult,
  AuthenticateFinishResult,
  PasskeySummary,
  RegisterBeginResult,
  RegisterFinishResult,
  RemovePasskeyResult,
} from "#/features/auth/server/webauthn-fns";
import { checkAuthRateLimitByIp } from "#/server/rate-limit.server";

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
    hasProfile: principal.hasProfile,
  };
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

// ── listing (session-gated) ──────────────────────────────────────────────

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
