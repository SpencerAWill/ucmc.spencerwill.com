/**
 * Test-only helpers that wrap multi-step DB writes whose production
 * equivalents live in higher-level action modules. Lives under
 * `#/server/db` so tests can import it through the standard alias
 * (`#/server/db/test-helpers`) without reaching across feature
 * boundaries.
 *
 * Production code paths must not import from this module — keep it to
 * test files and seed scripts.
 */
import { getDb, schema } from "#/server/db";

/**
 * Attach a verified primary email to an existing user row. Production
 * inserts both `users` and `user_emails` atomically through the
 * magic-link consume path; tests that build user state directly need to
 * mirror that, otherwise `loadPrincipal` throws on "no primary email".
 */
export async function attachPrimaryEmail(
  userId: string,
  email: string,
): Promise<void> {
  await getDb()
    .insert(schema.userEmails)
    .values({
      id: `uem_${crypto.randomUUID()}`,
      userId,
      email: email.trim().toLowerCase(),
      isPrimary: true,
      verifiedAt: new Date(),
    });
}
