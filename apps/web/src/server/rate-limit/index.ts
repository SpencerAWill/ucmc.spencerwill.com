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
