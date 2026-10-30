/**
 * Short-lived "email-verified proof" cookie. Set by `/auth/callback` when a
 * user clicks a valid magic link; read by `/register/profile` (and any
 * other route that needs to assert "this request is authorized to act on
 * this email but has not yet completed registration").
 *
 * The cookie value is `<payload>.<signature>` where:
 *   - payload = base64url(JSON({ email, intent, issuedAt }))
 *   - signature = base64url(HMAC-SHA256(payload, SESSION_SECRET))
 *
 * This is explicitly NOT a session: it cannot load a `Principal`, grants
 * no RBAC, and expires in 15 minutes. Rotating SESSION_SECRET invalidates
 * all outstanding proofs immediately. Signing lives in `signing.server.ts`;
 * this cookie signs the bare payload, without a purpose prefix — see there.
 */
import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";

import {
  base64UrlDecode,
  base64UrlEncode,
  hmacSign,
  timingSafeEqual,
} from "#/server/auth/signing.server";
import { serverEnv } from "#/server/env.server";
import type { schema } from "#/server/db";

export const PROOF_TTL_MS = 1000 * 60 * 15; // 15 minutes

export interface EmailProof {
  email: string;
  intent: schema.MagicLinkIntent;
  issuedAt: number;
}

const isSecure = () => serverEnv().APP_BASE_URL.startsWith("https://");

const proofCookieName = () => (isSecure() ? "__Host-ucmc_proof" : "ucmc_proof");

export async function writeProofCookie(proof: EmailProof): Promise<void> {
  const payload = base64UrlEncode(JSON.stringify(proof));
  const signature = await hmacSign(payload);
  setCookie(proofCookieName(), `${payload}.${signature}`, {
    httpOnly: true,
    secure: isSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(PROOF_TTL_MS / 1000),
  });
}

export async function readProofCookie(): Promise<EmailProof | null> {
  const raw = getCookie(proofCookieName());
  if (!raw) {
    return null;
  }
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) {
    return null;
  }
  const expected = await hmacSign(payload);
  if (!timingSafeEqual(signature, expected)) {
    return null;
  }
  let proof: EmailProof;
  try {
    proof = JSON.parse(base64UrlDecode(payload)) as EmailProof;
  } catch {
    return null;
  }
  if (Date.now() - proof.issuedAt > PROOF_TTL_MS) {
    return null;
  }
  return proof;
}

export function clearProofCookie(): void {
  deleteCookie(proofCookieName(), { path: "/", secure: isSecure() });
}
