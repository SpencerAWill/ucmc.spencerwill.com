/**
 * HMAC-SHA256 signing over `SESSION_SECRET`, for values the server hands
 * to the browser and must be able to trust when they come back: the
 * email-verified proof cookie and the WebAuthn ceremony cookie.
 *
 * A signed value is `<payload>.<signature>`, both base64url. Rotating
 * `SESSION_SECRET` invalidates every outstanding one at once.
 *
 * **Sign with a purpose.** `signJson` / `verifySignedJson` mix a purpose
 * string into the HMAC input, so a value signed for one cookie cannot be
 * replayed as another even though both share the secret. The proof
 * cookie predates this and signs the bare payload (`hmacSign(payload)`);
 * changing that would invalidate proofs in flight across a deploy, and
 * its payload shape cannot parse as a ceremony anyway.
 */
import { bytesToBase64Url } from "#/server/auth/bearer-token.server";
import { serverEnv } from "#/server/env.server";

function requireSecret(): string {
  const secret = serverEnv().SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set (>=32 chars) to issue or read signed cookies",
    );
  }
  return secret;
}

export function base64UrlEncode(s: string): string {
  return bytesToBase64Url(new TextEncoder().encode(s));
}

export function base64UrlDecode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return new TextDecoder().decode(
    Uint8Array.from(atob(padded + pad), (c) => c.charCodeAt(0)),
  );
}

export async function hmacSign(input: string): Promise<string> {
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
    new TextEncoder().encode(input),
  );
  return bytesToBase64Url(new Uint8Array(sig));
}

// Constant-time comparison of two equal-length base64url strings. (Short-
// circuiting `===` leaks timing info on signature length mismatches.)
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** `<base64url(JSON)>.<HMAC(purpose + "." + payload)>`. */
export async function signJson(
  purpose: string,
  value: unknown,
): Promise<string> {
  const payload = base64UrlEncode(JSON.stringify(value));
  const signature = await hmacSign(`${purpose}.${payload}`);
  return `${payload}.${signature}`;
}

/**
 * The parsed JSON if `raw` carries a valid signature for `purpose`, else
 * null. The signature proves only that this server minted the value —
 * callers still check its shape and any expiry it carries.
 */
export async function verifySignedJson(
  purpose: string,
  raw: string,
): Promise<unknown> {
  const [payload, signature, ...rest] = raw.split(".");
  if (!payload || !signature || rest.length > 0) {
    return null;
  }
  const expected = await hmacSign(`${purpose}.${payload}`);
  if (!timingSafeEqual(signature, expected)) {
    return null;
  }
  try {
    return JSON.parse(base64UrlDecode(payload)) as unknown;
  } catch {
    return null;
  }
}
