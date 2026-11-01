/**
 * The keyed fingerprint a terminated member's addresses are blocked by.
 *
 * `conduct_blocked_emails` holds `HMAC-SHA-256(CONDUCT_EMAIL_KEY,
 * normalizeEmail(email))` as lowercase hex, never the address: the club
 * keeps no readable list of removed members' emails, and without the key
 * a dump of the table cannot be checked against a guessed address
 * (docs/adr/0012-conduct-records-outlive-the-account.md).
 *
 * The address is normalized here, so callers pass whatever they hold.
 *
 * A missing key throws. Deployed, `configurationProblems` already refuses
 * to start without it; locally, throwing is what keeps a termination from
 * being written without its block, or a sign-in from skipping the check.
 *
 * Rotating the key orphans every stored fingerprint: rotation lifts
 * every block; it cannot be re-hashed, because plain addresses are never
 * stored.
 */
import { normalizeEmail } from "#/server/auth/email-normalize";
import { serverEnv } from "#/server/env.server";

export async function emailFingerprint(email: string): Promise<string> {
  const secret = serverEnv().CONDUCT_EMAIL_KEY;
  if (!secret) {
    throw new Error(
      "CONDUCT_EMAIL_KEY must be set (>=32 chars) to fingerprint conduct-blocked emails",
    );
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(normalizeEmail(email)),
  );
  return Array.from(new Uint8Array(mac), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
