import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export interface SeededUserOptions {
  /** Roles to assign. Defaults to `["role_member"]`. Pass
   *  `["role_system_admin"]` for an officer with the role-bypass that
   *  grants every permission, including `registrations:approve`. */
  roles?: string[];
}

/**
 * Insert a user with status='approved', a verified primary email, and a
 * filled-in profile on the local Miniflare D1 so e2e tests that need a
 * fully-registered user can sign in immediately and skip both the
 * registration form and admin approval.
 *
 * The seed always cleans up any prior rows for `email` first (cascading
 * through every child table) so re-runs against a reused dev server
 * land in a deterministic state. Pass a unique-per-test email
 * (`${prefix}-${Date.now()}@…`) so two tests in the same run don't
 * stomp on each other.
 *
 * Schema notes:
 *   - `users` no longer carries an `email` column (migration 0025);
 *     the verified address lives in `user_emails` with
 *     `is_primary = 1` and `verified_at` non-null.
 *   - The role assignments use `INSERT OR IGNORE` against the existing
 *     seed roles in 0001_rbac_seed / 0016_officer_roles_seed; passing
 *     a role id that doesn't exist silently no-ops at the FK layer
 *     and the test will fail later in a confusing place — keep the
 *     role list to seeded ids.
 */
export function ensureApprovedUser(
  email: string,
  options: SeededUserOptions = {},
): void {
  const userId = `user_${randomUUID()}`;
  // Public ID format mirrors generateUserPublicId() in src/server/auth/ids.ts:
  // 12 alphanumeric chars, no prefix. Test rows don't need cryptographic
  // uniqueness — uniqueness across runs comes from the random uuid.
  const publicId = randomUUID().replace(/-/g, "").slice(0, 12);
  const userEmailId = `uem_${randomUUID()}`;
  const nowMs = Date.now();
  const escapedEmail = `'${email.replace(/'/g, "''")}'`;
  const roles = options.roles ?? ["role_member"];

  // The `roles` values are not user input — they come from the test
  // file's call site, which passes literal strings from a known set.
  // Still, escape defensively in case a future caller threads them
  // through differently.
  const roleInserts = roles
    .map(
      (roleId) =>
        `INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES ('${userId}', '${roleId.replace(
          /'/g,
          "''",
        )}');`,
    )
    .join("\n");

  // 1. Wipe any stale rows for this email — `users` cascades through
  //    profiles, user_emails, sessions, user_roles, passkeys, etc.
  // 2. Insert fresh user + verified primary email + profile.
  // 3. Assign roles.
  const sql = `
DELETE FROM users WHERE id IN (SELECT user_id FROM user_emails WHERE email = ${escapedEmail});
INSERT INTO users (id, public_id, status, approved_at, created_at)
VALUES ('${userId}', '${publicId}', 'approved', ${nowMs}, ${nowMs});
INSERT INTO user_emails (id, user_id, email, is_primary, verified_at, created_at)
VALUES ('${userEmailId}', '${userId}', ${escapedEmail}, 1, ${nowMs}, ${nowMs});
INSERT INTO profiles (user_id, full_name, preferred_name, phone, uc_affiliation, updated_at)
VALUES ('${userId}', 'E2E Tester', 'E2E', '+15555550100', 'student', ${nowMs});
${roleInserts}
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

/**
 * Insert a `users` row with `status='unclaimed'` plus a primary
 * `user_emails` row with `verified_at = NULL` — the same shape that
 * `preAddUnclaimedMembersAction` produces in production. Used by e2e
 * specs that exercise the user-side claim flow without going through
 * the officer pre-add UI first.
 *
 * The seed cleans up any prior `users` row owning `email` first
 * (cascading through every child table) so re-runs against a reused
 * dev server land in a deterministic state. Pass a unique-per-test
 * email so tests in the same run don't collide on the global
 * `user_emails.email` UNIQUE.
 */
export function seedUnclaimedUser(
  email: string,
  options: { placeholderName?: string } = {},
): void {
  const userId = `user_${randomUUID()}`;
  const publicId = randomUUID().replace(/-/g, "").slice(0, 12);
  const userEmailId = `uem_${randomUUID()}`;
  const nowMs = Date.now();
  const escapedEmail = `'${email.replace(/'/g, "''")}'`;
  const placeholderName = options.placeholderName ?? "E2E Stub";
  const escapedName = `'${placeholderName.replace(/'/g, "''")}'`;
  const sql = `
DELETE FROM users WHERE id IN (SELECT user_id FROM user_emails WHERE email = ${escapedEmail});
INSERT INTO users (id, public_id, status, placeholder_name, unclaimed_at, created_at)
VALUES ('${userId}', '${publicId}', 'unclaimed', ${escapedName}, ${nowMs}, ${nowMs});
INSERT INTO user_emails (id, user_id, email, is_primary, verified_at, created_at)
VALUES ('${userEmailId}', '${userId}', ${escapedEmail}, 1, NULL, ${nowMs});
`;
  const tempFile = join(tmpdir(), `e2e-unclaimed-${randomUUID()}.sql`);
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

/**
 * Run an arbitrary D1 SQL block on the local Miniflare DB. Used by
 * specs that need to assert post-action database state (e.g. that a
 * row really got inserted) or that need a custom seed beyond what
 * `ensureApprovedUser` / `seedUnclaimedUser` support.
 *
 * Returns stdout from `wrangler d1 execute --json` (typed loosely so
 * callers can JSON.parse and pluck what they need).
 */
export function execD1(sql: string): string {
  const tempFile = join(tmpdir(), `e2e-exec-${randomUUID()}.sql`);
  writeFileSync(tempFile, sql, "utf8");
  try {
    return execSync(
      `pnpm exec wrangler d1 execute ucmc-web-dev --local --file ${tempFile} --json`,
      { cwd: WEB_DIR, encoding: "utf8" },
    );
  } finally {
    try {
      unlinkSync(tempFile);
    } catch {
      // best-effort
    }
  }
}
