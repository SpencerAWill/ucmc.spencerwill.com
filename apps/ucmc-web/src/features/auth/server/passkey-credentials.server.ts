/**
 * Tiny repository layer over the `passkey_credentials` D1 table. The
 * server fns in `webauthn-fns.ts` use these so they don't carry Drizzle
 * boilerplate inline — keeps each fn handler shaped like the magic-link
 * equivalents.
 *
 * Storage conventions:
 *   - `credentialId` is the WebAuthn credential ID as base64url (the same
 *     form simplewebauthn returns). Unique, indexed.
 *   - `publicKey` is the COSE-encoded public key, stored as base64url
 *     string so D1 can treat it as TEXT (we don't have BYTES columns).
 *   - `counter` is the sign counter; updated on each successful
 *     authenticate. Modern passkeys usually report 0 forever; a
 *     regression (newCounter < stored) signals a possible cloned auth.
 *   - `transports` is the JSON-encoded array of hints the browser gave
 *     us at register time (USB, internal, hybrid, etc.). Stored so
 *     re-authentication can pass them back to the browser for a
 *     slightly better prompt. Nullable.
 */
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import type { AuthenticatorTransportFuture } from "#/features/auth/server/webauthn.server";
import { getDb, schema } from "#/server/db";

export interface PasskeyCredentialRecord {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: AuthenticatorTransportFuture[] | undefined;
  nickname: string | null;
  createdAt: Temporal.Instant;
  lastUsedAt: Temporal.Instant | null;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Uint8Array.from(atob(padded + pad), (c) => c.charCodeAt(0));
}

function rowToRecord(
  row: typeof schema.passkeyCredentials.$inferSelect,
): PasskeyCredentialRecord {
  return {
    id: row.id,
    userId: row.userId,
    credentialId: row.credentialId,
    publicKey: base64UrlDecode(row.publicKey),
    counter: row.counter,
    transports: row.transports
      ? (JSON.parse(row.transports) as AuthenticatorTransportFuture[])
      : undefined,
    nickname: row.nickname,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export async function listCredentialsForUser(
  userId: string,
): Promise<PasskeyCredentialRecord[]> {
  const rows = await getDb().query.passkeyCredentials.findMany({
    where: eq(schema.passkeyCredentials.userId, userId),
  });
  return rows.map(rowToRecord);
}

export async function findCredentialByCredentialId(
  credentialId: string,
): Promise<PasskeyCredentialRecord | null> {
  const row = await getDb().query.passkeyCredentials.findFirst({
    where: eq(schema.passkeyCredentials.credentialId, credentialId),
  });
  return row ? rowToRecord(row) : null;
}

export async function insertCredential(args: {
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  nickname?: string;
}): Promise<PasskeyCredentialRecord> {
  const id = `pk_${uuidv7()}`;
  const now = Temporal.Now.instant();
  await getDb()
    .insert(schema.passkeyCredentials)
    .values({
      id,
      userId: args.userId,
      credentialId: args.credentialId,
      publicKey: base64UrlEncode(args.publicKey),
      counter: args.counter,
      transports: args.transports ? JSON.stringify(args.transports) : null,
      nickname: args.nickname ?? null,
      createdAt: now,
      lastUsedAt: null,
    });
  return {
    id,
    userId: args.userId,
    credentialId: args.credentialId,
    publicKey: args.publicKey,
    counter: args.counter,
    transports: args.transports,
    nickname: args.nickname ?? null,
    createdAt: now,
    lastUsedAt: null,
  };
}

export async function updateCredentialCounter(args: {
  credentialId: string;
  counter: number;
}): Promise<void> {
  await getDb()
    .update(schema.passkeyCredentials)
    .set({ counter: args.counter, lastUsedAt: Temporal.Now.instant() })
    .where(eq(schema.passkeyCredentials.credentialId, args.credentialId));
}

/**
 * Delete a credential. Scoped by userId so a caller can only remove
 * passkeys they own — even if they guess another user's credential ID.
 *
 * Returns the deleted row's surrogate `id` and its nickname, or null if
 * nothing matched. The caller needs both to write the `passkey.removed`
 * audit event: the `id` because that's what the log records as
 * `target_id`, and the nickname because after the delete there is no row
 * left to join against.
 */
export async function deleteCredentialForUser(args: {
  userId: string;
  credentialId: string;
}): Promise<{ id: string; nickname: string | null } | null> {
  const rows = await getDb()
    .delete(schema.passkeyCredentials)
    .where(
      and(
        eq(schema.passkeyCredentials.userId, args.userId),
        eq(schema.passkeyCredentials.credentialId, args.credentialId),
      ),
    )
    .returning({
      id: schema.passkeyCredentials.id,
      nickname: schema.passkeyCredentials.nickname,
    });
  // `length` for the same reason as `renameCredentialForUser` below: with
  // `noUncheckedIndexedAccess` off, `rows[0]` is typed as present even
  // when the delete matched nothing.
  return rows.length === 0 ? null : rows[0];
}

/**
 * Rename a credential. Scoped by userId for the same reason as the
 * delete above — a caller can only relabel passkeys they own.
 *
 * Returns the row's surrogate `id` plus the nickname it had beforehand
 * (so the caller can audit `{ before, after }`), or null if no row
 * matched. The pre-read is what supplies `before`; the scoped UPDATE's
 * `.returning()` is what proves a row actually changed, so a credential
 * deleted in the gap yields null rather than a phantom audit row.
 *
 * `nickname: null` clears the label, which is the state a passkey
 * registered without a nickname is already in.
 */
export async function renameCredentialForUser(args: {
  userId: string;
  credentialId: string;
  nickname: string | null;
}): Promise<{ id: string; previousNickname: string | null } | null> {
  const db = getDb();
  const existing = await db.query.passkeyCredentials.findFirst({
    where: and(
      eq(schema.passkeyCredentials.userId, args.userId),
      eq(schema.passkeyCredentials.credentialId, args.credentialId),
    ),
    columns: { nickname: true },
  });
  if (!existing) {
    return null;
  }
  const rows = await db
    .update(schema.passkeyCredentials)
    .set({ nickname: args.nickname })
    .where(
      and(
        eq(schema.passkeyCredentials.userId, args.userId),
        eq(schema.passkeyCredentials.credentialId, args.credentialId),
      ),
    )
    .returning({ id: schema.passkeyCredentials.id });
  // Test `length`, not `rows[0]`: `noUncheckedIndexedAccess` is off, so
  // the element type lies about a 0-row UPDATE (which is reachable —
  // the credential can be deleted between the read above and this
  // write) and a `!rows[0]` guard reads as provably dead code.
  if (rows.length === 0) {
    return null;
  }
  return { id: rows[0].id, previousNickname: existing.nickname };
}
