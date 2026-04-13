/**
 * Thin wrapper around @simplewebauthn/server. Exposes RP-aware helpers that
 * read RP id / name / origin from the Cloudflare env so callers don't have to.
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
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

import { env } from "#/server/cloudflare-env";

const rpID = () => env.WEBAUTHN_RP_ID;
const rpName = () => env.WEBAUTHN_RP_NAME;
const origin = () => env.APP_BASE_URL;

export interface ExistingCredential {
  credentialId: string; // base64url
  transports?: AuthenticatorTransportFuture[];
}

export async function startRegistration(args: {
  userId: string;
  userName: string; // typically email
  excludeCredentials?: ExistingCredential[];
}) {
  return generateRegistrationOptions({
    rpName: rpName(),
    rpID: rpID(),
    userID: new TextEncoder().encode(args.userId),
    userName: args.userName,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
    excludeCredentials: (args.excludeCredentials ?? []).map((c) => ({
      id: c.credentialId,
      transports: c.transports,
    })),
  });
}

export async function finishRegistration(args: {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
}) {
  return verifyRegistrationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin: origin(),
    expectedRPID: rpID(),
    requireUserVerification: false,
  });
}

export async function startAuthentication(args: {
  allowCredentials?: ExistingCredential[];
}) {
  return generateAuthenticationOptions({
    rpID: rpID(),
    userVerification: "preferred",
    allowCredentials: (args.allowCredentials ?? []).map((c) => ({
      id: c.credentialId,
      transports: c.transports,
    })),
  });
}

export async function finishAuthentication(args: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  credential: {
    credentialId: string;
    publicKey: string; // base64url
    counter: number;
    transports?: AuthenticatorTransportFuture[];
  };
}) {
  return verifyAuthenticationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin: origin(),
    expectedRPID: rpID(),
    credential: {
      id: args.credential.credentialId,
      publicKey: base64UrlToBytes(args.credential.publicKey),
      counter: args.credential.counter,
      transports: args.credential.transports,
    },
    requireUserVerification: false,
  });
}

function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const buffer = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
