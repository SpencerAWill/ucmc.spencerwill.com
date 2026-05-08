import { ensureApprovedUser } from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";
import { expect, test } from "./fixtures/mailpit";

/**
 * Officer drives the bulk pre-add UI end-to-end.
 *
 * Covers what the unit tests + component tests can't see together:
 *   - Route guard (`requirePermission("registrations:approve")`) lets
 *     the officer in.
 *   - Unclaimed tab swap on the registrations page.
 *   - Sheet open → dynamic-rows form fill → submit.
 *   - Server fn round-trip (`preAddUnclaimedFn`) lands in D1.
 *   - The mutation hook's invalidation flushes the unclaimed-list query
 *     so the new rows render in the tab without a manual reload.
 *
 * The action-layer logic itself (within-batch dedupe, email-taken
 * skips, audit log emission) is exhaustively unit-tested in
 * `unclaimed-actions.test.ts`; this spec exists to make sure the wiring
 * across HTTP + cookies + React Query holds together in a real browser.
 */
test("officer pre-adds unclaimed members via the bulk-add sheet", async ({
  page,
  mailpit,
}) => {
  // Seed an approved officer with the system_admin role (which carries
  // `registrations:approve` via the role-bypass). Email is unique-per-
  // run so retries don't collide on the user_emails UNIQUE constraint.
  const officerEmail = `e2e-officer-${Date.now()}@example.com`;
  ensureApprovedUser(officerEmail, { roles: ["role_system_admin"] });

  // Sign the officer in via the magic-link flow (the only auth path
  // that doesn't require manual session-cookie surgery).
  await page.goto("/sign-in");
  await waitForHydration(page);
  await page.getByRole("textbox", { name: /email/i }).fill(officerEmail);
  await page.getByRole("button", { name: /send sign-in link/i }).click();
  await expect(page.getByText(/check.*for a sign-in link/i)).toBeVisible();
  const link = await mailpit.extractFirstLink(officerEmail);
  const url = new URL(link);
  await page.goto(url.pathname + url.search);
  await waitForHydration(page);
  await page.getByRole("button", { name: /continue to ucmc/i }).click();
  // Approved-with-profile users land on `/` (or the original redirect
  // target). Waiting for the URL to leave `/auth/callback` is enough
  // to know the consume + redirect happened.
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/callback"), {
    timeout: 15_000,
  });

  // Navigate to the registrations page → switch to the Unclaimed tab.
  await page.goto("/members/registrations");
  await waitForHydration(page);
  await page.getByRole("button", { name: /^unclaimed$/i }).click();

  // Open the bulk-add sheet.
  await page.getByRole("button", { name: /pre-add members/i }).click();
  // Sheet is a slide-over Dialog; its title is the only "Pre-add"
  // heading on the page once open.
  await expect(
    page.getByRole("heading", { name: /pre-add unclaimed members/i }),
  ).toBeVisible();

  // Fill row 1 (the empty default). Names + emails are unique-per-run
  // so a re-run against a reused dev server doesn't see duplicates
  // from the previous run still in the unclaimed list.
  const runTag = Date.now();
  const nameA = `Alex Stub ${runTag}`;
  const nameB = `Bea Stub ${runTag}`;
  const candidateA = `e2e-stub-a-${runTag}@example.com`;
  const candidateB = `e2e-stub-b-${runTag}@example.com`;
  await page
    .getByRole("textbox", { name: /^name$/i })
    .first()
    .fill(nameA);
  await page
    .getByRole("textbox", { name: /^email$/i })
    .first()
    .fill(candidateA);

  // Add row 2.
  await page.getByRole("button", { name: /^add row$/i }).click();
  await page
    .getByRole("textbox", { name: /^name$/i })
    .nth(1)
    .fill(nameB);
  await page
    .getByRole("textbox", { name: /^email$/i })
    .nth(1)
    .fill(candidateB);

  // Submit. Button label is "Pre-add (N)" once N rows are valid.
  await page.getByRole("button", { name: /^pre-add \(\d+\)$/i }).click();

  // Result alert renders inline.
  await expect(page.getByText(/2 added, 0 skipped/i)).toBeVisible();

  // Close the sheet. There are two buttons named "Close" — the
  // SheetContent renders an automatic "X" icon-button at top-right
  // alongside our explicit footer button. The first match (our footer
  // button) is the deterministic one in DOM order.
  await page
    .getByRole("button", { name: /^close$/i })
    .first()
    .click();

  // The unclaimed-list query was invalidated by the mutation hook;
  // both rows should be visible in the tab without a reload.
  await expect(page.getByText(nameA)).toBeVisible();
  await expect(page.getByText(candidateA)).toBeVisible();
  await expect(page.getByText(nameB)).toBeVisible();
  await expect(page.getByText(candidateB)).toBeVisible();
});
