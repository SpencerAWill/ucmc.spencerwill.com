/**
 * Ceremony cookie for paired webauthn begin/finish server calls.
 *
 * `begin` mints a ceremony (`newCeremony`) and writes the whole thing —
 * id, challenge, type, user, expiry — into this cookie, HMAC-signed with
 * `SESSION_SECRET` under the `webauthn-ceremony` purpose. `finish` reads
 * it back and trusts it only if the signature verifies and it hasn't
 * expired, then consumes the ceremony id in D1 so it can't be used twice
 * (`webauthn-challenge.server.ts`). Nothing is stored at begin.
 *
 * The signature is what makes this safe to keep client-side: a forged or
 * edited cookie fails verification, and swapping in a challenge of the
 * attacker's choosing would need the secret. The purpose prefix stops a
 * proof cookie's signed value from being replayed here.
 *
 * The cookie is ephemeral (5 min maxAge, cleared on finish success OR
 * failure). SameSite=Strict because webauthn ceremonies are always
 * first-party — unlike the session cookie, no navigation between sites
 * needs to carry this cookie.
 */
import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";

import { CHALLENGE_TTL_SECONDS } from "#/features/auth/server/webauthn-challenge.server";
import type { Ceremony } from "#/features/auth/server/webauthn-challenge.server";
import { signJson, verifySignedJson } from "#/server/auth/signing.server";
import { env } from "#/server/cloudflare-env";

const PURPOSE = "webauthn-ceremony";

const isSecure = () => env.APP_BASE_URL.startsWith("https://");

// `__Host-` prefix in prod; the browser will only accept it over HTTPS
// with Path=/ and no Domain attribute — same defense-in-depth as the
// session cookie.
const cookieName = () =>
  isSecure() ? "__Host-ucmc_webauthn" : "ucmc_webauthn";

function isCeremony(value: unknown): value is Ceremony {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.challenge === "string" &&
    (v.type === "register" || v.type === "authenticate") &&
    (v.userId === undefined || typeof v.userId === "string") &&
    typeof v.expiresAt === "number"
  );
}

/**
 * `undefined` when there is no ceremony cookie at all; `null` when there is
 * one but it is forged, malformed or expired; otherwise the ceremony.
 */
export async function readCeremonyCookie(
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<Ceremony | null | undefined> {
  const raw = getCookie(cookieName());
  if (!raw) {
    return undefined;
  }
  const value = await verifySignedJson(PURPOSE, raw);
  if (!isCeremony(value) || value.expiresAt <= now.epochMilliseconds) {
    return null;
  }
  return value;
}

export async function writeCeremonyCookie(ceremony: Ceremony): Promise<void> {
  setCookie(cookieName(), await signJson(PURPOSE, ceremony), {
    httpOnly: true,
    secure: isSecure(),
    sameSite: "strict",
    path: "/",
    maxAge: CHALLENGE_TTL_SECONDS,
  });
}

export function clearCeremonyCookie(): void {
  deleteCookie(cookieName(), { path: "/", secure: isSecure() });
}
