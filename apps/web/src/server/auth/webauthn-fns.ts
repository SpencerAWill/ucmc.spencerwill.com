/**
 * Route-facing shells for the passkey (WebAuthn) server fns. Each
 * createServerFn handler dynamic-imports its implementation from
 * `./webauthn-actions.server` — the TanStack Start compiler strips the
 * handler body (and thus the dynamic import) from the client bundle, so
 * the simplewebauthn verify code, D1 accessors, and cookie helpers never
 * reach the browser.
 *
 * Shared result types are declared here so callers (routes, actions,
 * tests) can all reference them without touching `.server.ts` modules.
 *
 * Server fns:
 *   - webauthnRegisterBeginFn       (session-gated)
 *   - webauthnRegisterFinishFn      (session-gated)
 *   - webauthnAuthenticateBeginFn   (public; rate-limited)
 *   - webauthnAuthenticateFinishFn  (public; rate-limited)
 *   - removePasskeyFn               (session-gated)
 *   - listPasskeysFn                (session-gated GET)
 */
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { schema } from "#/server/db";

// ── result types (shared with webauthn-actions.server.ts) ────────────────

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

export interface PasskeySummary {
  credentialId: string;
  nickname: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

// ── register (session-gated) ─────────────────────────────────────────────

export const webauthnRegisterBeginFn = createServerFn({
  method: "POST",
}).handler(async (): Promise<RegisterBeginResult> => {
  const { webauthnRegisterBeginAction } =
    await import("#/server/auth/webauthn-actions.server");
  return webauthnRegisterBeginAction();
});

// `response` is the JSON payload @simplewebauthn/browser's
// startRegistration returns. We accept it as an opaque record and hand
// it to verifyRegistrationResponse, which does the actual schema check.
const registerFinishInput = z.object({
  response: z.unknown(),
  nickname: z.string().trim().max(60).optional(),
});

export const webauthnRegisterFinishFn = createServerFn({ method: "POST" })
  .inputValidator(registerFinishInput)
  .handler(async ({ data }): Promise<RegisterFinishResult> => {
    const { webauthnRegisterFinishAction } =
      await import("#/server/auth/webauthn-actions.server");
    return webauthnRegisterFinishAction({
      response: data.response as RegistrationResponseJSON,
      nickname: data.nickname,
    });
  });

// ── authenticate (public) ────────────────────────────────────────────────

export const webauthnAuthenticateBeginFn = createServerFn({
  method: "POST",
}).handler(async (): Promise<AuthenticateBeginResult> => {
  const { webauthnAuthenticateBeginAction } =
    await import("#/server/auth/webauthn-actions.server");
  return webauthnAuthenticateBeginAction();
});

const authenticateFinishInput = z.object({
  response: z.unknown(),
});

export const webauthnAuthenticateFinishFn = createServerFn({ method: "POST" })
  .inputValidator(authenticateFinishInput)
  .handler(async ({ data }): Promise<AuthenticateFinishResult> => {
    const { webauthnAuthenticateFinishAction } =
      await import("#/server/auth/webauthn-actions.server");
    return webauthnAuthenticateFinishAction({
      response: data.response as AuthenticationResponseJSON,
    });
  });

// ── remove / list (session-gated) ────────────────────────────────────────

const removePasskeyInput = z.object({
  credentialId: z.string().min(1).max(512),
});

export const removePasskeyFn = createServerFn({ method: "POST" })
  .inputValidator(removePasskeyInput)
  .handler(async ({ data }): Promise<RemovePasskeyResult> => {
    const { removePasskeyAction } =
      await import("#/server/auth/webauthn-actions.server");
    return removePasskeyAction({ credentialId: data.credentialId });
  });

export const listPasskeysFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ ok: boolean; passkeys: PasskeySummary[] }> => {
    const { listPasskeysAction } =
      await import("#/server/auth/webauthn-actions.server");
    return listPasskeysAction();
  },
);
