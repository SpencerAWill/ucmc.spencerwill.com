/**
 * KV-backed challenge store for webauthn ceremonies. Each begin/finish
 * pair stashes {challenge, userId?, type} under a random ceremony ID with
 * a 5-minute TTL. finish looks it up by the ID in the ceremony cookie,
 * verifies, and deletes — so the same challenge can never be replayed.
 *
 * KV's minimum expirationTtl is 60 seconds; 300s (5 min) matches the
 * ceremony cookie's maxAge so entries disappear naturally even if finish
 * never runs.
 */
import { getKv } from "#/server/kv";

export const CHALLENGE_TTL_SECONDS = 300;

export type WebAuthnCeremonyType = "register" | "authenticate";

export interface StoredChallenge {
  challenge: string;
  type: WebAuthnCeremonyType;
  // Only present for register ceremonies — verified against the caller's
  // session in finish to prevent a user from registering a passkey against
  // someone else's account mid-flight.
  userId?: string;
}

function key(ceremonyId: string): string {
  return `webauthn:ceremony:${ceremonyId}`;
}

export function newCeremonyId(): string {
  return crypto.randomUUID();
}

export async function putChallenge(
  ceremonyId: string,
  value: StoredChallenge,
): Promise<void> {
  await getKv().put(key(ceremonyId), JSON.stringify(value), {
    expirationTtl: CHALLENGE_TTL_SECONDS,
  });
}

export async function getChallenge(
  ceremonyId: string,
): Promise<StoredChallenge | null> {
  const raw = await getKv().get(key(ceremonyId));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as StoredChallenge;
  } catch {
    return null;
  }
}

export async function deleteChallenge(ceremonyId: string): Promise<void> {
  await getKv().delete(key(ceremonyId));
}
