import { getRequestHeader } from "@tanstack/react-start/server";

import { env } from "#/server/cloudflare-env";

/**
 * Checks the /health rate-limiter binding for the caller's IP. Returns
 * `true` when the request is within budget, `false` when it should be
 * degraded or refused.
 *
 * Key is `CF-Connecting-IP` — set by Cloudflare at the edge on every
 * real request, and always accurate (cannot be spoofed like
 * `X-Forwarded-For`). Locally (Miniflare) the header is absent; we fall
 * back to a single `"local"` bucket so dev traffic still exercises the
 * binding rather than silently bypassing it.
 *
 * Never throws — a broken binding must not take the health page down
 * (which would defeat the purpose). On error we fail *open* (allow), on
 * the theory that losing rate-limit protection is less bad than the
 * health page 500ing.
 */
export async function checkHealthRateLimit(): Promise<boolean> {
  try {
    const key = getRequestHeader("cf-connecting-ip") ?? "local";
    const { success } = await env.HEALTH_RATE_LIMITER.limit({ key });
    return success;
  } catch {
    return true;
  }
}

/**
 * Client IP for auth rate-limit keys. Same Cloudflare-authoritative
 * header as the health limiter; falls back to "local" under Miniflare.
 */
function clientIp(): string {
  return getRequestHeader("cf-connecting-ip") ?? "local";
}

/**
 * Gate an auth operation by IP. Call at the TOP of magic-link request,
 * magic-link consume, and passkey authentication handlers — before any
 * D1/KV work — so a flood can't amplify into storage calls.
 *
 * Returns true to allow the request; false to refuse it. Fails open on
 * binding error (same reasoning as `checkHealthRateLimit`).
 */
export async function checkAuthRateLimitByIp(): Promise<boolean> {
  try {
    const { success } = await env.AUTH_RATE_LIMITER.limit({
      key: `ip:${clientIp()}`,
    });
    return success;
  } catch {
    return true;
  }
}

/**
 * Gate an auth operation by email. Layered on top of the IP limiter so
 * one attacker can't enumerate by rotating IPs through a residential
 * proxy pool: even with infinite IPs, the per-email budget bites. Caller
 * must normalize the email (lowercase/trim) before keying.
 */
export async function checkAuthRateLimitByEmail(
  normalizedEmail: string,
): Promise<boolean> {
  try {
    const { success } = await env.AUTH_RATE_LIMITER.limit({
      key: `email:${normalizedEmail}`,
    });
    return success;
  } catch {
    return true;
  }
}

/**
 * Gate an avatar upload by user. Keyed by the signed-in user's id so
 * one account can't burn R2 PUTs by replaying the form. Fails open on
 * binding error.
 */
export async function checkUploadRateLimit(userId: string): Promise<boolean> {
  try {
    const { success } = await env.UPLOAD_RATE_LIMITER.limit({
      key: `user:${userId}`,
    });
    return success;
  } catch {
    return true;
  }
}
