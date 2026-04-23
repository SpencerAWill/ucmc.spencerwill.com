/**
 * Session store + lifecycle helpers. Sessions are opaque IDs in an
 * HTTP-only cookie, backed by a row in the D1 `sessions` table. There's no
 * signing because there's nothing to sign — the ID itself is the secret,
 * and its validity is decided by "does the row still exist and hasn't
 * expired".
 *
 * Lifecycle:
 *   - `openSession(userId)` → insert row, write cookie.
 *   - `loadCurrentPrincipal()` → read cookie → look up row → load principal;
 *     slides `lastSeenAt`/`expiresAt` if ~1h has passed since last read.
 *   - `rotateSession(userId)` → replace the session ID atomically: issue a
 *     new row, write the new cookie, delete the old row. Called on every
 *     privilege boundary (email verification, passkey enrollment,
 *     approval). If the current cookie points at nothing (stolen, cleared,
 *     expired), this still opens a fresh session without erroring.
 *   - `closeSession()` → delete row + clear cookie.
 */
import { eq } from "drizzle-orm";

import { loadPrincipal } from "#/server/auth/principal.server";
import type { Principal } from "#/server/auth/principal.server";
import {
  SESSION_SLIDING_REFRESH_MS,
  SESSION_TTL_MS,
} from "#/server/auth/session-config";
import { getDb, schema } from "#/server/db";
import {
  clearSessionCookie,
  readSessionCookie,
  writeSessionCookie,
} from "#/server/session-cookie.server";

interface SessionRow {
  id: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

async function getSessionRow(sid: string): Promise<SessionRow | null> {
  const row = await getDb().query.sessions.findFirst({
    where: eq(schema.sessions.id, sid),
  });
  if (!row) {
    return null;
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    await deleteSessionRow(sid);
    return null;
  }
  return row;
}

async function insertSessionRow(userId: string): Promise<string> {
  const sid = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await getDb().insert(schema.sessions).values({
    id: sid,
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });
  return sid;
}

async function slideSessionRow(sid: string): Promise<void> {
  const now = new Date();
  await getDb()
    .update(schema.sessions)
    .set({
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    })
    .where(eq(schema.sessions.id, sid));
}

async function deleteSessionRow(sid: string): Promise<void> {
  await getDb().delete(schema.sessions).where(eq(schema.sessions.id, sid));
}

/**
 * Create a new session for `userId` and write the cookie. Does NOT close an
 * existing session (callers that want rotation should use `rotateSession`).
 */
export async function openSession(userId: string): Promise<void> {
  const sid = await insertSessionRow(userId);
  writeSessionCookie(sid);
}

/**
 * Replace the current session with a fresh one for `userId`. Invalidates
 * the old session ID (can't be re-used if it leaked). Safe to call when
 * there's no current session — it just opens one.
 */
export async function rotateSession(userId: string): Promise<void> {
  const oldSid = readSessionCookie();
  const newSid = await insertSessionRow(userId);
  writeSessionCookie(newSid);
  if (oldSid && oldSid !== newSid) {
    await deleteSessionRow(oldSid);
  }
}

/**
 * Delete the current session (if any) and clear the cookie.
 */
export async function closeSession(): Promise<void> {
  const sid = readSessionCookie();
  if (sid) {
    await deleteSessionRow(sid);
  }
  clearSessionCookie();
}

/**
 * Resolve the current request's principal. Returns null for anonymous
 * requests, bad cookies, expired sessions, or orphaned sessions (session
 * row exists but its user was deleted). Also does the sliding-window
 * refresh of `expiresAt` if enough time has passed since `lastSeenAt`.
 */
export async function loadCurrentPrincipal(): Promise<Principal | null> {
  const sid = readSessionCookie();
  if (!sid) {
    return null;
  }

  const session = await getSessionRow(sid);
  if (!session) {
    clearSessionCookie();
    return null;
  }

  const principal = await loadPrincipal(session.userId);
  if (!principal) {
    // Session points at a user that no longer exists — clean up.
    await deleteSessionRow(sid);
    clearSessionCookie();
    return null;
  }

  if (Date.now() - session.lastSeenAt.getTime() > SESSION_SLIDING_REFRESH_MS) {
    await slideSessionRow(sid);
  }

  return principal;
}
