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
 * Officer pre-add → user claim flow (browser side).
 *
 * 1. Seed a `users` row with status="unclaimed" plus a primary
 *    `user_emails` row with `verified_at = NULL` — the same shape that
 *    `preAddUnclaimedMembersAction` produces in production.
 * 2. As that user, request a magic link, follow it through Mailpit,
 *    and confirm we land on /register/profile with the on-file email
 *    pre-populated.
 *
 * The DB-level claim contract (status flips to "approved",
 * placeholderName + unclaimedAt NULLed, verifiedAt stamped, audit log
 * captures `member.claimed`) is exercised in
 * `auth-flows.test.ts > unclaimed claim flow` running against the same
 * Miniflare D1 — that's a faster, more granular signal than driving the
 * profile form through a real browser. This e2e covers the bits those
 * tests can't see: cookies + headers + redirects across real HTTP +
 * Vite SSR.
 */
test("officer-pre-added unclaimed member can claim their account", async ({
  page,
  mailpit,
}) => {
  const email = `e2e-unclaimed-${Date.now()}@example.com`;
  const userId = `user_${randomUUID()}`;
  const publicId = randomUUID().replace(/-/g, "").slice(0, 12);
  const userEmailId = `uem_${randomUUID()}`;
  const nowMs = Date.now();
  const escapedEmail = `'${email.replace(/'/g, "''")}'`;
  const seed = `
INSERT INTO users (id, public_id, status, placeholder_name, unclaimed_at, created_at)
VALUES ('${userId}', '${publicId}', 'unclaimed', 'E2E Stub', ${nowMs}, ${nowMs});
INSERT INTO user_emails (id, user_id, email, is_primary, verified_at, created_at)
VALUES ('${userEmailId}', '${userId}', ${escapedEmail}, 1, NULL, ${nowMs});
`;
  const tempFile = join(tmpdir(), `e2e-unclaimed-${randomUUID()}.sql`);
  writeFileSync(tempFile, seed, "utf8");
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

  // Request a magic link for the on-file address. From the user's POV
  // this is just signing in — they don't know they're "claiming."
  await page.goto("/sign-in");
  await waitForHydration(page);
  // Disambiguate from the footer's "Email UCMC" mailto link by scoping
  // to the textbox role.
  await page.getByRole("textbox", { name: /email/i }).fill(email);
  const submit = page.getByRole("button", { name: /send sign-in link/i });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText(/check.*for a sign-in link/i)).toBeVisible();

  const link = await mailpit.extractFirstLink(email);
  const url = new URL(link);
  await page.goto(url.pathname + url.search);
  await waitForHydration(page);

  // Anti-prefetch interstitial.
  await page.getByRole("button", { name: /continue to ucmc/i }).click();

  // The consume handler stamps `verifiedAt`, opens a session, and the
  // requireApproved guard (no profile yet) bounces us to the profile
  // form.
  await page.waitForURL(/\/register\/profile/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/register\/profile/);

  // Email field should be pre-populated read-only with the on-file
  // address.
  const emailField = page.getByRole("textbox", { name: /^email$/i });
  await expect(emailField).toHaveValue(email);
});
