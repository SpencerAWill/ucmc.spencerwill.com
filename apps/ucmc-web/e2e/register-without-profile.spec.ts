import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { waitForHydration } from "./fixtures/hydration";
import { expect, test } from "./fixtures/mailpit";

const WEB_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Regression: a returning user with a `users` row but no `profiles` row
 * must be able to finish registering via the magic-link flow.
 *
 * Before the fix, `/register/profile` was gated on `requireProof()`,
 * which only accepts the email-verified proof cookie. The magic-link
 * callback's "user w/o profile" branch (consumeMagicLinkAction in
 * server/auth/magic-link-actions.server.ts) opens a SESSION cookie
 * instead of writing a proof — so the route bounced these users to
 * `/sign-in?register=true`, where requesting a new link looped them
 * back through the same dead-end. The replacement guard
 * `requireRegistrationContext` accepts either signal.
 */
test("returning user with no profile can reach /register/profile via magic link", async ({
  page,
  mailpit,
}) => {
  const email = `e2e-noprofile-${Date.now()}@example.com`;

  // Pre-create the half-registered state: user row exists (status
  // doesn't matter for this test, but pending mirrors a real
  // post-registration-but-before-profile state), no profile row.
  const userId = `user_${randomUUID()}`;
  const publicId = `usr_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const nowMs = Date.now();
  const escapedEmail = `'${email.replace(/'/g, "''")}'`;
  const sql = `
INSERT INTO users (id, public_id, email, status, created_at)
VALUES ('${userId}', '${publicId}', ${escapedEmail}, 'pending', ${nowMs});
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

  // Standard magic-link sign-in.
  await page.goto("/sign-in");
  await waitForHydration(page);

  await page.getByLabel(/email/i).fill(email);
  const submit = page.getByRole("button", { name: /send sign-in link/i });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText(/check.*for a sign-in link/i)).toBeVisible();

  const link = await mailpit.extractFirstLink(email);
  const url = new URL(link);
  await page.goto(url.pathname + url.search);
  await waitForHydration(page);

  await page.getByRole("button", { name: /continue to ucmc/i }).click();

  // The bug: this used to land on /sign-in?register=true. The fix means
  // it lands on /register/profile, where the form renders with the
  // user's email pre-populated. Either /register/profile (initial
  // landing) or any other authenticated destination would prove the
  // session is open; we assert the specific page so a regression
  // resurfaces immediately.
  await page.waitForURL(/\/register\/profile/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/register\/profile/);

  // The form's read-only email field should reflect the session's email.
  const emailField = page.getByLabel(/^email$/i);
  await expect(emailField).toHaveValue(email);
});
