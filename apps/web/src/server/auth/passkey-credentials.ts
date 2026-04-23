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

import type { AuthenticatorTransportFuture } from "#/server/auth/webauthn";
import { getDb, schema } from "#/server/db";

export interface PasskeyCredentialRecord {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: AuthenticatorTransportFuture[] | undefined;
  nickname: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
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
  const id = `pk_${crypto.randomUUID()}`;
  const now = new Date();
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
    .set({ counter: args.counter, lastUsedAt: new Date() })
    .where(eq(schema.passkeyCredentials.credentialId, args.credentialId));
}

/**
 * Delete a credential. Scoped by userId so a caller can only remove
 * passkeys they own — even if they guess another user's credential ID.
 * Returns true iff a row was deleted.
 */
export async function deleteCredentialForUser(args: {
  userId: string;
  credentialId: string;
}): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.passkeyCredentials)
    .where(
      and(
        eq(schema.passkeyCredentials.userId, args.userId),
        eq(schema.passkeyCredentials.credentialId, args.credentialId),
      ),
    )
    .returning({ id: schema.passkeyCredentials.id });
  return rows.length > 0;
}
