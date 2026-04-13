/**
 * Session cookie helpers. The cookie is HTTP-only, Secure, SameSite=Lax, and
 * holds an opaque session ID; the corresponding record lives in KV.
 */
import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";

import { env } from "#/server/cloudflare-env";

// Browsers silently reject Secure cookies over http://, so in local dev
// (APP_BASE_URL=http://localhost:...) we have to disable Secure. In any
// deployed env APP_BASE_URL is https and Secure is required.
const isSecure = () => env.APP_BASE_URL.startsWith("https://");

// `__Host-` prefix is a defense-in-depth signal: the browser only accepts
// the cookie when it's set with Secure, Path=/, and no Domain attribute,
// preventing subdomain cookie injection. It only works over HTTPS, so in
// local dev (no Secure) we drop the prefix.
const sessionCookieName = () =>
  isSecure() ? "__Host-ucmc_session" : "ucmc_session";

export function readSessionCookie(): string | undefined {
  return getCookie(sessionCookieName());
}

export function writeSessionCookie(sid: string): void {
  setCookie(sessionCookieName(), sid, {
    httpOnly: true,
    secure: isSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

export function clearSessionCookie(): void {
  deleteCookie(sessionCookieName(), { path: "/" });
}
