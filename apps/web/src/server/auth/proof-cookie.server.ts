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
 * all outstanding proofs immediately.
 */
import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";

import { env } from "#/server/cloudflare-env";
import type { schema } from "#/server/db";

export const PROOF_TTL_MS = 1000 * 60 * 15; // 15 minutes

export interface EmailProof {
  email: string;
  intent: schema.MagicLinkIntent;
  issuedAt: number;
}

const isSecure = () => env.APP_BASE_URL.startsWith("https://");

const proofCookieName = () => (isSecure() ? "__Host-ucmc_proof" : "ucmc_proof");

function requireSecret(): string {
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set (>=32 chars) to issue or read proof cookies",
    );
  }
  return secret;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncode(s: string): string {
  return bytesToBase64Url(new TextEncoder().encode(s));
}

function base64UrlDecode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return new TextDecoder().decode(
    Uint8Array.from(atob(padded + pad), (c) => c.charCodeAt(0)),
  );
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requireSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return bytesToBase64Url(new Uint8Array(sig));
}

// Constant-time comparison of two equal-length base64url strings. (Short-
// circuiting `===` leaks timing info on signature length mismatches.)
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function writeProofCookie(proof: EmailProof): Promise<void> {
  const payload = base64UrlEncode(JSON.stringify(proof));
  const signature = await hmac(payload);
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
  const expected = await hmac(payload);
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
  deleteCookie(proofCookieName(), { path: "/" });
}
