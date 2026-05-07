/**
 * Single source of truth for email normalization. Every site that
 * inserts into `user_emails.email` or looks up by it must agree on
 * the normalized form, or the unique index won't match.
 *
 * The zod validator at `apps/web/src/features/auth/server/server-fns.ts`
 * also normalizes inbound user input — this helper exists for the
 * defense-in-depth call inside server-side helpers and for any code
 * path that constructs an address from a non-validated source (the
 * backfill script, the seed script, internal lookups by a value
 * read back out of D1).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
