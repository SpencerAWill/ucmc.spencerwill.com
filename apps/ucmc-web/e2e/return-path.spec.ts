import { ensureApprovedUser } from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";
import { expect, test } from "./fixtures/mailpit";

/**
 * Signing in lands back on the page that was asked for (#303), search
 * params included. The guard writes the path into `/sign-in?redirect=`,
 * the magic-link email carries it, and `/auth/callback` follows it.
 *
 * `/members` is gated by `requireApproved` in its `_tabs` layout, so this
 * also covers a guard on a parent route reading the leaf's location.
 * The search uses two keys so a dropped or mangled `&` shows up.
 */
test("a signed-out visitor to a gated page returns to it after the magic link", async ({
  page,
  mailpit,
}) => {
  const email = `e2e-return-path-${Date.now()}@example.com`;
  ensureApprovedUser(email);
  const target = "/members?q=e2e&sort=created";

  await page.goto(target);
  await page.waitForURL(/\/sign-in/);
  expect(new URL(page.url()).searchParams.get("redirect")).toBe(target);
  await waitForHydration(page);

  await page.getByRole("textbox", { name: /email/i }).fill(email);
  const submit = page.getByRole("button", { name: /email me a link/i });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText(/check.*for a link/i)).toBeVisible();

  const link = new URL(await mailpit.extractFirstLink(email));
  expect(link.searchParams.get("redirect")).toBe(target);
  await page.goto(link.pathname + link.search);
  await waitForHydration(page);
  await page.getByRole("button", { name: /continue to ucmc/i }).click();

  await page.waitForURL((u) => u.pathname === "/members", { timeout: 15_000 });
  const landed = new URL(page.url());
  expect(landed.searchParams.get("q")).toBe("e2e");
  expect(landed.searchParams.get("sort")).toBe("created");
});
