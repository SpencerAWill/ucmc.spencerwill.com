/**
 * D1-backed store for ephemeral auth state — sessions, magic-link tokens,
 * and WebAuthn ceremony challenges.
 *
 * Previously this lived in KV. Moved to D1 because:
 *   1. KV is eventually consistent (~60s); a session created at one edge can
 *      appear missing at another, breaking sign-in immediately after auth.
 *   2. Magic-link single-use needs an atomic check-and-consume; KV `get` then
 *      `delete` is racy. SQLite `UPDATE ... WHERE consumed_at IS NULL` is not.
 */
import { and, eq, isNull, lt } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export interface MagicLinkRecord {
  email: string;
  intent: schema.MagicLinkIntent;
  createdAt: number;
}

export interface WebAuthnChallengeRecord {
  challenge: string;
  userId?: string;
}

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export const MAGIC_LINK_TTL_MS = 1000 * 60 * 15; // 15 min
export const WEBAUTHN_CHALLENGE_TTL_MS = 1000 * 60 * 5; // 5 min

const now = () => new Date();
const msFrom = (date: Date) => date.getTime();

// ── sessions ────────────────────────────────────────────────────────────────

export async function getSession(sid: string): Promise<SessionRecord | null> {
  const row = await getDb().query.sessions.findFirst({
    where: eq(schema.sessions.id, sid),
  });
  if (!row) return null;
  if (msFrom(row.expiresAt) <= Date.now()) {
    await deleteSession(sid);
    return null;
  }
  return {
    id: row.id,
    userId: row.userId,
    createdAt: msFrom(row.createdAt),
    lastSeenAt: msFrom(row.lastSeenAt),
    expiresAt: msFrom(row.expiresAt),
  };
}

export async function putSession(record: SessionRecord): Promise<void> {
  await getDb()
    .insert(schema.sessions)
    .values({
      id: record.id,
      userId: record.userId,
      createdAt: new Date(record.createdAt),
      lastSeenAt: new Date(record.lastSeenAt),
      expiresAt: new Date(record.expiresAt),
    })
    .onConflictDoUpdate({
      target: schema.sessions.id,
      set: {
        lastSeenAt: new Date(record.lastSeenAt),
        expiresAt: new Date(record.expiresAt),
      },
    });
}

export async function deleteSession(sid: string): Promise<void> {
  await getDb().delete(schema.sessions).where(eq(schema.sessions.id, sid));
}

// ── magic-link tokens ───────────────────────────────────────────────────────

export async function putMagicLink(
  token: string,
  record: MagicLinkRecord,
): Promise<void> {
  await getDb()
    .insert(schema.magicLinks)
    .values({
      token,
      email: record.email,
      intent: record.intent,
      createdAt: now(),
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
    });
}

/**
 * Atomic single-use consumption. Sets `consumed_at` only if it's currently
 * NULL and the token isn't expired; returns the row in the same statement.
 * If two requests race, only one gets a row back.
 */
export async function consumeMagicLink(
  token: string,
): Promise<MagicLinkRecord | null> {
  const consumedAt = now();
  const updated = await getDb()
    .update(schema.magicLinks)
    .set({ consumedAt })
    .where(
      and(
        eq(schema.magicLinks.token, token),
        isNull(schema.magicLinks.consumedAt),
      ),
    )
    .returning();

  const row = updated.at(0);
  if (!row) return null;
  if (msFrom(row.expiresAt) <= Date.now()) return null;
  return {
    email: row.email,
    intent: row.intent,
    createdAt: msFrom(row.createdAt),
  };
}

// ── WebAuthn ceremony challenges ────────────────────────────────────────────

export async function putWebAuthnChallenge(
  id: string,
  scope: schema.WebAuthnChallengeScope,
  record: WebAuthnChallengeRecord,
): Promise<void> {
  await getDb()
    .insert(schema.webauthnChallenges)
    .values({
      id,
      scope,
      challenge: record.challenge,
      userId: record.userId ?? null,
      expiresAt: new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS),
    })
    .onConflictDoUpdate({
      target: schema.webauthnChallenges.id,
      set: {
        challenge: record.challenge,
        userId: record.userId ?? null,
        expiresAt: new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS),
      },
    });
}

export async function consumeWebAuthnChallenge(
  id: string,
): Promise<WebAuthnChallengeRecord | null> {
  const rows = await getDb()
    .delete(schema.webauthnChallenges)
    .where(eq(schema.webauthnChallenges.id, id))
    .returning();
  const row = rows.at(0);
  if (!row) return null;
  if (msFrom(row.expiresAt) <= Date.now()) return null;
  return { challenge: row.challenge, userId: row.userId ?? undefined };
}

// ── housekeeping ────────────────────────────────────────────────────────────

/**
 * Sweep expired rows. D1 has no TTL — call this from a cron trigger if/when
 * one is added. Cheap (indexed scan on expires_at).
 */
export async function sweepExpired(): Promise<void> {
  const cutoff = now();
  const db = getDb();
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, cutoff));
  await db
    .delete(schema.magicLinks)
    .where(lt(schema.magicLinks.expiresAt, cutoff));
  await db
    .delete(schema.webauthnChallenges)
    .where(lt(schema.webauthnChallenges.expiresAt, cutoff));
}
