/**
 * Reads against the `banned_emails` blocklist. The blocklist is the
 * persistence half of the ban feature — `banMembersAction` writes it
 * (one row per email of the banned user); the magic-link request,
 * add-email request, and add-email consume paths all read it before
 * doing any irreversible work.
 *
 * The blocklist is independent of the user row. Rows survive
 * `users.id` cascades via `ON DELETE SET NULL`, so a banned user who
 * later self-deletes still has their addresses blocked. That's why
 * the auth flows can't just check `users.status === "banned"` — the
 * user might be gone.
 *
 * Email values are stored normalized (`trim().toLowerCase()`); every
 * read here normalizes the input through `normalizeEmail` so the
 * primary-key probe matches the unique-index discipline the rest of
 * the auth surface follows.
 */
import { eq } from "drizzle-orm";

import { normalizeEmail } from "#/server/auth/email-normalize";
import { getDb, schema } from "#/server/db";

/**
 * Returns true if `email` (after normalization) is on the blocklist.
 * Single-row equality probe against the PRIMARY KEY — cheap enough to
 * sit in front of every magic-link request.
 */
export async function isEmailBanned(email: string): Promise<boolean> {
  const row = await getDb().query.bannedEmails.findFirst({
    where: eq(schema.bannedEmails.email, normalizeEmail(email)),
    columns: { email: true },
  });
  return row !== undefined;
}
