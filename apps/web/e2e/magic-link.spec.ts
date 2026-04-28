import { expect, test } from "./fixtures/mailpit";

/**
 * Golden-path magic-link sign-in: request the link, retrieve it from the
 * Mailpit dev sidecar, follow the consume URL, and assert the post-sign-in
 * destination.
 *
 * For an unregistered email, the consume step lands on /register/profile
 * (the registration profile form). That's the simplest end-state to assert
 * without seeding data — no D1 fixtures needed.
 */
test("magic-link sign-in sends an email and the consume link signs the user in", async ({
  page,
  mailpit,
}) => {
  // Use a per-test email so Mailpit's search doesn't see leftover messages
  // from a previous run that didn't reach the cleanup step.
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/sign-in");

  const emailInput = page.getByLabel(/email/i);
  const submit = page.getByRole("button", { name: /send sign-in link/i });
  await expect(submit).toBeVisible();

  // The page is SSR'd with the submit button disabled (TanStack Form's
  // onMount validator runs on the empty default and fails). We need
  // typing to land *after* React hydration replays its state, otherwise
  // the controlled input snaps back to empty. Hydration timing is
  // racy, so retry the fill until the button enables.
  await expect
    .poll(
      async () => {
        await emailInput.fill(email);
        return submit.isDisabled();
      },
      { timeout: 10_000, message: "submit button never enabled after fill" },
    )
    .toBe(false);
  await expect(emailInput).toHaveValue(email);
  await submit.click();

  // Form transitions to the "check your email" success state. Confirm
  // before checking Mailpit so a backend failure doesn't masquerade as
  // a slow email.
  await expect(page.getByText(/check.*for a sign-in link/i)).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  const link = await mailpit.extractFirstLink(email);

  // The link includes the absolute APP_BASE_URL set by the dev server.
  // Strip it so page.goto follows it relative to baseURL — keeps the
  // test resilient to different dev hostnames (e.g. forwarded port vs
  // container-internal).
  const url = new URL(link);
  await page.goto(url.pathname + url.search);

  // The callback page renders a "Continue" button that the user must
  // click before the token is consumed — defeats enterprise email
  // scanners that pre-GET every link. Click it to actually verify.
  // Same hydration race as the sign-in form — click before hydration
  // attaches the React onClick handler and the click is lost. Retry
  // the click until the URL leaves the callback page.
  const continueButton = page.getByRole("button", {
    name: /continue to ucmc/i,
  });
  await expect(continueButton).toBeVisible();
  await expect
    .poll(
      async () => {
        if (!page.url().includes("/auth/callback")) {
          return true;
        }
        await continueButton.click().catch(() => undefined);
        return !page.url().includes("/auth/callback");
      },
      { timeout: 15_000, message: "callback page never redirected" },
    )
    .toBe(true);

  await expect(page).toHaveURL(/\/register\/profile/);
});
