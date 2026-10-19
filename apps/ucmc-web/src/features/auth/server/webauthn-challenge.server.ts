/**
 * WebAuthn ceremonies: what a ceremony is, and how one is used up.
 *
 * **Begin writes nothing.** The ceremony — challenge, type, user, expiry —
 * travels in the HMAC-signed ceremony cookie (`webauthn-ceremony.server.ts`).
 * Passkey autofill begins one on every `/sign-in` load, so a stored row per
 * begin would cost D1 writes for page views, and an abusive IP could spend
 * the daily write quota by reloading a page (#314 review).
 *
 * **Finish consumes it in D1, in one statement.** `consumeCeremony` inserts
 * the ceremony's id into `webauthn_consumed_ceremonies` with `ON CONFLICT
 * DO NOTHING RETURNING`: the first finish gets a row back, any later or
 * concurrent one gets nothing. This replaced a KV `get` then `delete`,
 * which two concurrent finishes could both pass (#314). Magic links hold
 * the same line with `UPDATE … WHERE consumed_at IS NULL RETURNING`.
 *
 * A marker only needs to outlive the cookie it guards, so it carries the
 * ceremony's expiry and the daily retention tick sweeps it after that.
 */
import { getDb, schema } from "#/server/db";

/**
 * The one ceremony lifetime: the signed expiry and the cookie's maxAge
 * (`webauthn-ceremony.server.ts`) both read it, so they can't drift.
 */
export const CHALLENGE_TTL_SECONDS = 300;

export type WebAuthnCeremonyType = "register" | "authenticate";

export interface Ceremony {
  id: string;
  challenge: string;
  type: WebAuthnCeremonyType;
  // Only present for register ceremonies — verified against the caller's
  // session in finish to prevent a user from registering a passkey against
  // someone else's account mid-flight.
  userId?: string;
  /** Epoch ms. JSON-safe, since the ceremony lives in a cookie. */
  expiresAt: number;
}

export function newCeremony(
  fields: Pick<Ceremony, "challenge" | "type" | "userId">,
  now: Temporal.Instant = Temporal.Now.instant(),
): Ceremony {
  return {
    id: crypto.randomUUID(),
    ...fields,
    expiresAt: now.add({ seconds: CHALLENGE_TTL_SECONDS }).epochMilliseconds,
  };
}

/**
 * Use the ceremony up. True for exactly one caller per ceremony id, false
 * for every other — whether it came later or at the same moment.
 */
export async function consumeCeremony(ceremony: Ceremony): Promise<boolean> {
  const rows = await getDb()
    .insert(schema.webauthnConsumedCeremonies)
    .values({
      id: ceremony.id,
      expiresAt: Temporal.Instant.fromEpochMilliseconds(ceremony.expiresAt),
    })
    .onConflictDoNothing()
    .returning({ id: schema.webauthnConsumedCeremonies.id });
  return rows.length > 0;
}
