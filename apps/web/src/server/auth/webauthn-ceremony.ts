/**
 * Ceremony cookie for paired webauthn begin/finish server calls.
 *
 * `begin` endpoints mint a random ceremony ID, stash the challenge + user
 * context in KV keyed by that ID, and set this cookie so the matching
 * `finish` call can look the row back up. The cookie is ephemeral (5 min
 * maxAge, cleared on finish success OR failure) — a stolen cookie can't be
 * replayed because the challenge gets deleted on the first finish attempt.
 *
 * Unlike the proof cookie, the value is not HMAC-signed: the KV value is
 * the trust anchor (an attacker who forges a ceremony cookie would still
 * need the real challenge blob, which they can't retrieve without the ID).
 *
 * SameSite=Strict because webauthn ceremonies are always first-party —
 * unlike the session cookie, no navigation between sites needs to carry
 * this cookie.
 */
import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";

import { env } from "#/server/cloudflare-env";

export const CEREMONY_TTL_MS = 1000 * 60 * 5; // 5 minutes

const isSecure = () => env.APP_BASE_URL.startsWith("https://");

// `__Host-` prefix in prod; the browser will only accept it over HTTPS
// with Path=/ and no Domain attribute — same defense-in-depth as the
// session cookie.
const cookieName = () =>
  isSecure() ? "__Host-ucmc_webauthn" : "ucmc_webauthn";

export function readCeremonyCookie(): string | undefined {
  return getCookie(cookieName());
}

export function writeCeremonyCookie(ceremonyId: string): void {
  setCookie(cookieName(), ceremonyId, {
    httpOnly: true,
    secure: isSecure(),
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(CEREMONY_TTL_MS / 1000),
  });
}

export function clearCeremonyCookie(): void {
  deleteCookie(cookieName(), { path: "/" });
}
