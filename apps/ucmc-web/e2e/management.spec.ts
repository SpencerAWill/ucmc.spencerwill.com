import type { Page } from "@playwright/test";

import { ensureApprovedUser, queryD1, seedUserWithStatus } from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";
import { expect, test } from "./fixtures/mailpit";

/**
 * Coverage for the consolidated `/members` admin surface (Approved /
 * Pending / Unclaimed / Rejected / Deactivated tabs):
 *   - The members directory dropped its status filter (admin status
 *     concerns moved into the tab bar).
 *   - Switching between the rejected and deactivated tabs resets the
 *     row-selection state — regression for the React reconciliation
 *     bug where the same `LifecycleTab` instance carried a stale Set
 *     across tabs.
 *   - Bulk reactivate flips status back to `approved` and refreshes
 *     the deactivated tab.
 *
 * Why e2e and not unit/component: the bugs these tests guard live at
 * the React reconciliation + router boundaries. A jsdom render of the
 * component in isolation would let the test re-mount on every tab
 * switch (defeating the regression check); only a real router-driven
 * navigation reproduces the production code path.
 */

/** Look up the current `users.status` for a given email (asserting on
 *  post-mutation DB state). */
function readStatus(email: string): string | null {
  const rows = queryD1<{ status: string }>(
    `SELECT u.status as status FROM users u
     JOIN user_emails ue ON ue.user_id = u.id
     WHERE ue.email = ?`,
    email,
  );
  return rows[0]?.status ?? null;
}

/** Sign in as an officer (system_admin role) via the magic-link flow.
 *  Uses a generous mailpit timeout (30 s) because the dev server's
 *  `padTiming()` jitter on the magic-link request adds 500–800 ms per
 *  call, and back-to-back specs can pile up enough latency to brush
 *  the default 10 s budget. */
async function signInAsOfficer(
  page: Page,
  mailpit: {
    extractFirstLink: (email: string, timeoutMs?: number) => Promise<string>;
  },
  email: string,
): Promise<void> {
  ensureApprovedUser(email, { roles: ["role_system_admin"] });
  await page.goto("/sign-in");
  await waitForHydration(page);
  await page.getByRole("textbox", { name: /email/i }).fill(email);
  await page.getByRole("button", { name: /send sign-in link/i }).click();
  await expect(page.getByText(/check.*for a sign-in link/i)).toBeVisible();
  const link = await mailpit.extractFirstLink(email, 30_000);
  const url = new URL(link);
  await page.goto(url.pathname + url.search);
  await waitForHydration(page);
  await page.getByRole("button", { name: /continue to ucmc/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/callback"), {
    timeout: 15_000,
  });
}

test("/members directory has no status filter dropdown", async ({
  page,
  mailpit,
}) => {
  // Officer (role_system_admin) used to see a status filter on the
  // directory; the refactor moved every non-approved status to its own
  // tab so the filter shouldn't render — even for admins.
  const officerEmail = `e2e-officer-filter-${Date.now()}@example.com`;
  await signInAsOfficer(page, mailpit, officerEmail);

  await page.goto("/members");
  await waitForHydration(page);

  // Directory subtitle copy is the simpler "Approved club members."
  // line, no longer parameterized on the active status filter.
  await expect(page.getByText(/approved club members/i)).toBeVisible();

  // No combobox is offering "Approved / Pending / Rejected / Deactivated".
  // The only remaining selects on the page are the sort + per-page
  // controls, neither of which exposes status options.
  const filterCombo = page.getByRole("combobox", { name: /status/i });
  await expect(filterCombo).toHaveCount(0);
});

test("switching between rejected and deactivated tabs clears row selection", async ({
  page,
  mailpit,
}) => {
  const officerEmail = `e2e-officer-tabs-${Date.now()}@example.com`;
  const rejectedEmail = `e2e-rejected-${Date.now()}@example.com`;
  const deactivatedEmail = `e2e-deact-${Date.now()}@example.com`;
  seedUserWithStatus(rejectedEmail, "rejected");
  seedUserWithStatus(deactivatedEmail, "deactivated");
  await signInAsOfficer(page, mailpit, officerEmail);

  await page.goto("/members/rejected");
  await waitForHydration(page);

  // Check the rejected row.
  const rejectedRow = page.getByRole("checkbox", {
    name: new RegExp(`select ${rejectedEmail}`, "i"),
  });
  await rejectedRow.check();
  await expect(rejectedRow).toBeChecked();
  // Bulk button reflects the selection.
  await expect(
    page.getByRole("button", { name: /^un-reject \(1\)/i }),
  ).toBeVisible();

  // Switch to the deactivated tab via the tab bar link.
  await page.getByRole("link", { name: /^deactivated$/i }).click();
  await page.waitForURL((u) => u.pathname === "/members/deactivated");
  await waitForHydration(page);

  // Wait for the new tab's data to render.
  const deactivatedBox = page.getByRole("checkbox", {
    name: new RegExp(`select ${deactivatedEmail}`, "i"),
  });
  await expect(deactivatedBox).toBeVisible();

  // Regression signal lives in the toolbar's count summary span:
  //   - leaked state → "1 of N selected" (the rejected userId
  //     persists in `selected`)
  //   - clean remount → "N deactivated" (no selection)
  // The bulk button itself isn't a reliable disambiguator because the
  // per-row icon button has the same accessible name "Reactivate".
  await expect(page.getByText(/of \d+ selected/i)).toHaveCount(0);
  await expect(page.getByText(/\d+ deactivated/i)).toBeVisible();

  // And the deactivated row's checkbox is not pre-checked.
  await expect(deactivatedBox).not.toBeChecked();
});

test("bulk reactivate flips status to approved and removes the row from the tab", async ({
  page,
  mailpit,
}) => {
  const officerEmail = `e2e-officer-react-${Date.now()}@example.com`;
  const targetEmail = `e2e-react-target-${Date.now()}@example.com`;
  seedUserWithStatus(targetEmail, "deactivated");
  await signInAsOfficer(page, mailpit, officerEmail);

  await page.goto("/members/deactivated");
  await waitForHydration(page);

  const targetRow = page.getByRole("checkbox", {
    name: new RegExp(`select ${targetEmail}`, "i"),
  });
  await expect(targetRow).toBeVisible();
  await targetRow.check();

  // Bulk button label disambiguates by the count suffix — the row's
  // per-row icon button never carries `(N)`.
  await page.getByRole("button", { name: /^reactivate \(1\)/i }).click();

  // The reactivated row leaves this tab because the mutation
  // invalidates MEMBERS_REGISTRATIONS_QUERY_KEY and the list refetches.
  // We assert on the SPECIFIC row disappearing rather than the empty-
  // state, since other deactivated rows from earlier specs in the same
  // dev-server session may still populate the tab.
  await expect(targetRow).toHaveCount(0, { timeout: 10_000 });

  // And the underlying row's status really did flip back to approved
  // — defense in depth so a future regression that just hides the
  // row visually (e.g. by stale cache) still fails the test.
  expect(readStatus(targetEmail)).toBe("approved");
});
