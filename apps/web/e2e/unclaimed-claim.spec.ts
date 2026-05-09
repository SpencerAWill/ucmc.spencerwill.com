import { seedUnclaimedUser } from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";
import { expect, test } from "./fixtures/mailpit";

/**
 * Officer pre-add → user claim flow (browser side).
 *
 * 1. Seed a `users` row with status="unclaimed" plus a primary
 *    `user_emails` row with `verified_at = NULL` — the same shape that
 *    `preAddUnclaimedMembersAction` produces in production.
 * 2. As that user, request a magic link, follow it through Mailpit,
 *    and confirm we land on /register/profile with the on-file email
 *    pre-populated.
 * 3. Fill the profile form, tick the policies checkbox, submit, and
 *    assert the post-claim destination is /my/account (auto-approved,
 *    no pending wait).
 *
 * Step 3 catches a regression that the workers-pool unit tests can't:
 * if the registration form's labels, layout, or wiring change in a way
 * that prevents an unclaimed user from completing their profile, the
 * claim path silently breaks even though the action layer still works.
 * The DB-level claim contract (status flip, placeholder NULLing,
 * audit-log entry) is also pinned by `auth-flows.test.ts > unclaimed
 * claim flow` — this e2e is the cross-stack belt-and-suspenders.
 */
test("officer-pre-added unclaimed member can claim their account", async ({
  page,
  mailpit,
}) => {
  const email = `e2e-unclaimed-${Date.now()}@example.com`;
  seedUnclaimedUser(email);

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

  // Fill the form. Field labels mirror the components under
  // `apps/web/src/components/profile/` (private-detail-fields.tsx,
  // public-profile-fields.tsx, emergency-contact-fields.tsx).
  await page
    .getByRole("textbox", { name: /^full name$/i })
    .fill("Claimer Smith");
  await page
    .getByRole("textbox", { name: /^preferred name$/i })
    .fill("Claimer");
  // Phone uses react-phone-number-input which parses on each keystroke
  // and stores E.164 internally — `.fill()` would set the displayed
  // value without triggering the parser. `pressSequentially` simulates
  // real typing so the form state lands on `+15135550199`.
  await page
    .getByRole("textbox", { name: /^phone$/i })
    .first()
    .pressSequentially("5135550199");

  // UC affiliation is a Radix Select rendered as a combobox button.
  await page.getByRole("combobox", { name: /uc affiliation/i }).click();
  await page.getByRole("option", { name: /^student$/i }).click();

  // Emergency contacts are optional and the form starts with the
  // dynamic array empty (no contact cards rendered) — no need to fill
  // any here, which keeps the locator surface small and resilient to
  // layout changes inside the array section.

  // Tick the policies checkbox. Using `check()` over `click()` is more
  // robust against re-rendering: it asserts the post-state and retries
  // if the click didn't register, which it sometimes doesn't on Radix
  // composite checkboxes whose visible label re-mounts mid-click.
  const policiesCheckbox = page.getByRole("checkbox", { name: /policies/i });
  await policiesCheckbox.check();
  await expect(policiesCheckbox).toBeChecked();
  // Force blur so any onBlur-gated validators run before we measure
  // canSubmit on the submit button.
  await policiesCheckbox.blur();

  // Wait for the form's `canSubmit` to flip true. Validation runs
  // async after each field change; on cold boots the worker takes a
  // moment to compile the validators.
  await expect(
    page.getByRole("button", { name: /submit for review/i }),
  ).toBeEnabled({ timeout: 15_000 });

  await page.getByRole("button", { name: /submit for review/i }).click();

  // submitProfileAction's claim branch flips status straight to
  // "approved" (officer pre-add IS the approval signal) and NULLs the
  // placeholder columns. Approved users with profiles land on
  // /my/account, not /register/pending.
  await page.waitForURL(/\/my\/account/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/my\/account/);
});
