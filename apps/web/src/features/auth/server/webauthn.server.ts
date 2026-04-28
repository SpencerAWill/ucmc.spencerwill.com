/**
 * Thin wrapper over @simplewebauthn/server that pins the Relying Party
 * config to the Worker's environment. Centralized here so the four
 * webauthn server fns don't have to repeat `rpID` / `rpName` / `origin`
 * plumbing on every call.
 *
 * rpID is the hostname the credential is bound to — a passkey registered
 * under `dev.ucmc.spencerwill.com` cannot be used on `ucmc.spencerwill.com`
 * (WebAuthn spec). It's pulled from `env.WEBAUTHN_RP_ID`, which Pulumi
 * sets per-env (see apps/web/src/server/cloudflare-env.ts).
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

import { env } from "#/server/cloudflare-env";

function rpID(): string {
  return env.WEBAUTHN_RP_ID;
}

function rpName(): string {
  return env.WEBAUTHN_RP_NAME;
}

function expectedOrigin(): string {
  // APP_BASE_URL is the scheme+host the browser sees; WebAuthn verify
  // enforces that the clientDataJSON.origin matches exactly.
  return env.APP_BASE_URL;
}

export interface UserForRegistration {
  id: string;
  email: string;
  displayName?: string;
}

export async function buildRegistrationOptions(
  user: UserForRegistration,
  existingCredentialIds: string[],
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpID: rpID(),
    rpName: rpName(),
    userName: user.email,
    userDisplayName: user.displayName ?? user.email,
    // simplewebauthn accepts `userID` as a Uint8Array so we encode the
    // stable account id. The browser only uses it to dedupe credentials
    // per-account; we never rely on its bytes server-side.
    userID: new TextEncoder().encode(user.id),
    // Exclude already-registered credentials so the browser doesn't let
    // the user re-enroll the same authenticator twice.
    excludeCredentials: existingCredentialIds.map((id) => ({ id })),
    authenticatorSelection: {
      residentKey: "required", // discoverable credentials — enables passkey autofill
      userVerification: "preferred",
    },
    // Start wants ES256 + RS256; simplewebauthn defaults are fine but
    // we set explicitly so the list is a stable, reviewed surface.
    supportedAlgorithmIDs: [-7, -257],
  });
}

export async function verifyRegistration(args: {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
}) {
  return verifyRegistrationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin: expectedOrigin(),
    expectedRPID: rpID(),
    requireUserVerification: false,
  });
}

export async function buildAuthenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: rpID(),
    // Empty allowCredentials → discoverable-credentials flow. The browser
    // shows the user their list of passkeys for this RP; we don't have
    // to know who they are before the ceremony.
    allowCredentials: [],
    userVerification: "preferred",
  });
}

export async function verifyAuthentication(args: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  credentialPublicKey: Uint8Array;
  credentialID: string;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
}) {
  return verifyAuthenticationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin: expectedOrigin(),
    expectedRPID: rpID(),
    credential: {
      id: args.credentialID,
      // `.slice()` narrows Uint8Array<ArrayBufferLike> → Uint8Array<ArrayBuffer>
      // which is what simplewebauthn's internal `Uint8Array_` alias requires
      // under TypeScript's lib.es2024.arraybuffer typings.
      publicKey: args.credentialPublicKey.slice(),
      counter: args.counter,
      transports: args.transports,
    },
    requireUserVerification: false,
  });
}

// Re-export so callers can type their credential-row shape without
// importing from @simplewebauthn/server directly.
export type { AuthenticatorTransportFuture };
