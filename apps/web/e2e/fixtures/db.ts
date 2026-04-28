import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * Insert (or promote) a user to status='approved' WITH a filled-in profile
 * on the local Miniflare D1 so e2e tests that need a fully-registered user
 * can sign in immediately and skip both the registration form and admin
 * approval flow.
 *
 * Mirrors the SQL pattern in `drizzle/seed.ts` but takes the email as an
 * argument and also seeds a `profiles` row — necessary because the
 * /register/profile route is gated on the proof cookie (NOT a session), so
 * a session-holding user without a profile gets bounced. Approved users
 * with profiles land on "/" after the magic-link callback, which is the
 * branch e2e tests want.
 *
 * Idempotent: re-running with the same email does nothing on the inserts,
 * and the gated UPDATE no-ops if the row is already approved.
 */
export function ensureApprovedUser(email: string): void {
  const userId = `user_${randomUUID()}`;
  // Public ID format mirrors generateUserPublicId() in src/server/auth/ids.ts:
  // 12 hex chars, prefixed `usr_`. Test rows don't need cryptographic
  // uniqueness — INSERT OR IGNORE means we only ever insert once anyway.
  const publicId = `usr_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const nowMs = Date.now();
  const escapedEmail = `'${email.replace(/'/g, "''")}'`;
  // Clear existing passkey credentials too — passkey e2e accumulates one
  // per run, and stale entries match `getByText('e2e device')` and break
  // strict-mode locators on subsequent runs.
  const sql = `
INSERT OR IGNORE INTO users (id, public_id, email, status, approved_at, created_at)
VALUES ('${userId}', '${publicId}', ${escapedEmail}, 'approved', ${nowMs}, ${nowMs});
UPDATE users
SET status = 'approved', approved_at = ${nowMs}
WHERE email = ${escapedEmail} AND status <> 'approved';
INSERT OR IGNORE INTO profiles
  (user_id, full_name, preferred_name, m_number, phone, uc_affiliation, updated_at)
SELECT id, 'E2E Tester', 'E2E', 'M00000000', '+15555550100', 'student', ${nowMs}
FROM users WHERE email = ${escapedEmail};
DELETE FROM passkey_credentials
WHERE user_id IN (SELECT id FROM users WHERE email = ${escapedEmail});
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE email = ${escapedEmail});
`;
  const tempFile = join(tmpdir(), `e2e-seed-${randomUUID()}.sql`);
  writeFileSync(tempFile, sql, "utf8");
  try {
    execSync(
      `pnpm exec wrangler d1 execute ucmc-web-dev --local --file ${tempFile}`,
      { cwd: WEB_DIR, stdio: "pipe" },
    );
  } finally {
    try {
      unlinkSync(tempFile);
    } catch {
      // best-effort
    }
  }
}
