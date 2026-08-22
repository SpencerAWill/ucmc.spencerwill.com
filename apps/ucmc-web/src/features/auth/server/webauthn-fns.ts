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
 *   - renamePasskeyFn               (session-gated)
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

/** `nickname` echoes the stored value so the client can reconcile
 *  optimistic state with the server's trimming (and with an
 *  all-whitespace name having been normalized to null). */
export type RenamePasskeyResult =
  | { ok: true; nickname: string | null }
  | { ok: false; reason: "unauthorized" | "not_found" };

export interface PasskeySummary {
  credentialId: string;
  nickname: string | null;
  /** Temporal crosses the server-fn wire via the serialization adapters
   *  registered in `src/start.ts`, so these stay Instants rather than
   *  pre-stringified dates — matching `MyEmailSummary` and letting the
   *  UI format them through `#/lib/date-format`. */
  createdAt: Temporal.Instant;
  lastUsedAt: Temporal.Instant | null;
}

// ── register (session-gated) ─────────────────────────────────────────────

export const webauthnRegisterBeginFn = createServerFn({
  method: "POST",
}).handler(async (): Promise<RegisterBeginResult> => {
  const { webauthnRegisterBeginAction } =
    await import("#/features/auth/server/webauthn-actions.server");
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
  .validator(registerFinishInput)
  .handler(async ({ data }): Promise<RegisterFinishResult> => {
    const { webauthnRegisterFinishAction } =
      await import("#/features/auth/server/webauthn-actions.server");
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
    await import("#/features/auth/server/webauthn-actions.server");
  return webauthnAuthenticateBeginAction();
});

const authenticateFinishInput = z.object({
  response: z.unknown(),
});

export const webauthnAuthenticateFinishFn = createServerFn({ method: "POST" })
  .validator(authenticateFinishInput)
  .handler(async ({ data }): Promise<AuthenticateFinishResult> => {
    const { webauthnAuthenticateFinishAction } =
      await import("#/features/auth/server/webauthn-actions.server");
    return webauthnAuthenticateFinishAction({
      response: data.response as AuthenticationResponseJSON,
    });
  });

// ── remove / rename / list (session-gated) ──────────────────────────────

const removePasskeyInput = z.object({
  credentialId: z.string().min(1).max(512),
});

const renamePasskeyInput = z.object({
  credentialId: z.string().min(1).max(512),
  // Same 60-char cap as the nickname on registration
  // (`registerFinishInput`), so a label can't be longer than the field
  // that created it. Not `.min(1)`: an empty string is the documented
  // way to clear the label, which the action normalizes to null.
  nickname: z.string().trim().max(60),
});

export const removePasskeyFn = createServerFn({ method: "POST" })
  .validator(removePasskeyInput)
  .handler(async ({ data }): Promise<RemovePasskeyResult> => {
    const { removePasskeyAction } =
      await import("#/features/auth/server/webauthn-actions.server");
    return removePasskeyAction({ credentialId: data.credentialId });
  });

export const renamePasskeyFn = createServerFn({ method: "POST" })
  .validator(renamePasskeyInput)
  .handler(async ({ data }): Promise<RenamePasskeyResult> => {
    const { renamePasskeyAction } =
      await import("#/features/auth/server/webauthn-actions.server");
    return renamePasskeyAction({
      credentialId: data.credentialId,
      nickname: data.nickname,
    });
  });

export const listPasskeysFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ ok: boolean; passkeys: PasskeySummary[] }> => {
    const { listPasskeysAction } =
      await import("#/features/auth/server/webauthn-actions.server");
    return listPasskeysAction();
  },
);
