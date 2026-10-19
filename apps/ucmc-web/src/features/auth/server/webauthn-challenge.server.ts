/**
 * D1-backed challenge store for webauthn ceremonies. Each begin/finish
 * pair stores {challenge, type, userId?} under a random ceremony ID with
 * a 5-minute lifetime. finish consumes it by the ID in the ceremony
 * cookie with one `DELETE … RETURNING`, so exactly one caller ever gets a
 * given challenge back — concurrent finishes included (#314).
 *
 * This was KV, read with `get` and removed with a separate `delete`. Two
 * finishes could both read the challenge before either deleted it, and
 * KV's eventual consistency let a cached read outlive the delete. See
 * `0084_webauthn_ceremonies.sql`.
 *
 * 300s (5 min) matches the ceremony cookie's maxAge. A row that outlives
 * it is rejected at consume and swept by the daily retention tick.
 */
import { eq } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export const CHALLENGE_TTL_SECONDS = 300;

export type WebAuthnCeremonyType = (typeof schema.webauthnCeremonyType)[number];

export interface StoredChallenge {
  challenge: string;
  type: WebAuthnCeremonyType;
  // Only present for register ceremonies — verified against the caller's
  // session in finish to prevent a user from registering a passkey against
  // someone else's account mid-flight.
  userId?: string;
}

export function newCeremonyId(): string {
  return crypto.randomUUID();
}

export async function putChallenge(
  ceremonyId: string,
  value: StoredChallenge,
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<void> {
  await getDb()
    .insert(schema.webauthnCeremonies)
    .values({
      id: ceremonyId,
      challenge: value.challenge,
      type: value.type,
      userId: value.userId ?? null,
      createdAt: now,
      expiresAt: now.add({ seconds: CHALLENGE_TTL_SECONDS }),
    });
}

/**
 * Take the ceremony's challenge, removing it in the same statement.
 * Returns null when there is no such ceremony, it was already consumed,
 * or it has expired. An expired row is deleted all the same.
 */
export async function consumeChallenge(
  ceremonyId: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<StoredChallenge | null> {
  const rows = await getDb()
    .delete(schema.webauthnCeremonies)
    .where(eq(schema.webauthnCeremonies.id, ceremonyId))
    .returning();
  // A length check, not `rows[0] === undefined`: without
  // `noUncheckedIndexedAccess` the index types as always defined and lint
  // calls the guard dead code (#274). It is the "no such ceremony" path.
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  if (Temporal.Instant.compare(row.expiresAt, now) <= 0) {
    return null;
  }
  return {
    challenge: row.challenge,
    type: row.type,
    ...(row.userId === null ? {} : { userId: row.userId }),
  };
}
