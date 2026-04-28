import { waitForHydration } from "./fixtures/hydration";
import { expect, test } from "./fixtures/mailpit";

/**
 * Golden-path magic-link sign-in: request the link, retrieve it from the
 * Mailpit dev sidecar, follow the consume URL, and assert the post-sign-in
 * destination.
 *
 * For an unregistered email the consume step lands on /register/profile
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
  await waitForHydration(page);

  await page.getByLabel(/email/i).fill(email);
  const submit = page.getByRole("button", { name: /send sign-in link/i });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByText(/check.*for a sign-in link/i)).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  const link = await mailpit.extractFirstLink(email);

  // The link includes the absolute APP_BASE_URL set by the dev server.
  // Strip it so page.goto follows it relative to baseURL — keeps the
  // test resilient to different dev hostnames (e.g. forwarded port vs
  // container-internal).
  const url = new URL(link);
  await page.goto(url.pathname + url.search);
  await waitForHydration(page);

  // The callback page renders a "Continue" button that the user must
  // click before the token is consumed — defeats enterprise email
  // scanners that pre-GET every link.
  await page.getByRole("button", { name: /continue to ucmc/i }).click();

  // For a brand-new email the post-consume decision is /register/profile.
  await page.waitForURL(/\/register\/profile/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/register\/profile/);
});
