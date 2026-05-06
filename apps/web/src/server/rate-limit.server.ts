import { getRequestHeader } from "@tanstack/react-start/server";

import { env } from "#/server/cloudflare-env";

/**
 * E2e-only escape hatch. When `E2E_BYPASS_RATE_LIMIT=1` is set on the
 * Worker env, every limiter check short-circuits to "allowed". Set by
 * Playwright's webServer config because the suite hits 6+ auth endpoints
 * per run and the 10 req/60 s budget would trip mid-run on a reused dev
 * server. Production envs MUST NEVER set this.
 */
function isBypassed(): boolean {
  return env.E2E_BYPASS_RATE_LIMIT === "1";
}

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
  if (isBypassed()) {
    return true;
  }
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
  if (isBypassed()) {
    return true;
  }
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
  if (isBypassed()) {
    return true;
  }
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
  if (isBypassed()) {
    return true;
  }
  try {
    const { success } = await env.UPLOAD_RATE_LIMITER.limit({
      key: `user:${userId}`,
    });
    return success;
  } catch {
    return true;
  }
}

/**
 * Gate a feedback submission by user. Reuses the AUTH_RATE_LIMITER
 * binding under a distinct key namespace (`feedback:user:<id>`) — the
 * limiter counts per key, so this does not contend with auth-flow keys.
 * The 10 req/60 s budget is far more than legitimate feedback usage and
 * cheaper than provisioning a fourth binding. Fails open on binding
 * error so a broken limiter doesn't block submissions.
 */
export async function checkFeedbackRateLimit(userId: string): Promise<boolean> {
  if (isBypassed()) {
    return true;
  }
  try {
    const { success } = await env.AUTH_RATE_LIMITER.limit({
      key: `feedback:user:${userId}`,
    });
    return success;
  } catch {
    return true;
  }
}
