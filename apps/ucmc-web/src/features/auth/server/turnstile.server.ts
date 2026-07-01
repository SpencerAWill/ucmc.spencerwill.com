/**
 * Cloudflare Turnstile server-side token verification. Called before any
 * rate-limit or DB work so a bot can't amplify into storage calls.
 *
 * When TURNSTILE_SECRET_KEY is unset (local dev without a widget), the
 * check is bypassed — the form doesn't render the widget either, so
 * there's no token to verify. In deployed envs both the site key and
 * the secret key must be set.
 */
import { getRequestHeader } from "@tanstack/react-start/server";

import { env } from "#/server/cloudflare-env";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(token: string): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // No secret configured — skip verification (local dev).
    return true;
  }

  try {
    const ip = getRequestHeader("cf-connecting-ip") ?? "";
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: ip,
      }),
    });
    if (!res.ok) {
      return false;
    }
    const data: { success: boolean } = await res.json();
    return data.success;
  } catch {
    // Turnstile API unreachable — fail open so a Turnstile outage
    // doesn't lock users out of sign-in. Rate limiting is the next
    // layer of defense.
    return true;
  }
}
