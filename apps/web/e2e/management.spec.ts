import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { ensureApprovedUser, execD1 } from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";
import { expect, test } from "./fixtures/mailpit";

/**
 * Coverage for the consolidated `/members/management` admin surface:
 *   - Old `/members/registrations` URL still works (redirect).
 *   - The members directory dropped its status filter (admin status
 *     concerns moved here).
 *   - Switching between the rejected and deactivated tabs resets the
 *     row-selection state — regression for the React reconciliation
 *     bug where the same `LifecycleView` instance carried a stale Set
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

/** Insert a `users` row with the given status + a verified primary
 *  email. Bypasses the registration flow so deactivated/rejected
 *  rows can be set up directly. */
function seedUserWithStatus(
  email: string,
  status: "approved" | "deactivated" | "rejected",
): void {
  const userId = `user_${randomUUID()}`;
  const publicId = randomUUID().replace(/-/g, "").slice(0, 12);
  const userEmailId = `uem_${randomUUID()}`;
  const nowMs = Date.now();
  const escapedEmail = `'${email.replace(/'/g, "''")}'`;
  // Match what `deactivateMembersAction` / `rejectRegistrationsAction`
  // would produce so the management page's queries treat the row
  // identically to one that took the real path.
  const statusTimestamp =
    status === "deactivated"
      ? `deactivated_at, ${nowMs}`
      : status === "rejected"
        ? `rejected_at, ${nowMs}`
        : null;
  const extraColumns = statusTimestamp
    ? `, ${statusTimestamp.split(",")[0]}`
    : "";
  const extraValues = statusTimestamp
    ? `, ${statusTimestamp.split(",")[1]}`
    : "";

  const sql = `
DELETE FROM users WHERE id IN (SELECT user_id FROM user_emails WHERE email = ${escapedEmail});
INSERT INTO users (id, public_id, status, created_at${extraColumns})
VALUES ('${userId}', '${publicId}', '${status}', ${nowMs}${extraValues});
INSERT INTO user_emails (id, user_id, email, is_primary, verified_at, created_at)
VALUES ('${userEmailId}', '${userId}', ${escapedEmail}, 1, ${nowMs}, ${nowMs});
INSERT INTO profiles (user_id, full_name, preferred_name, phone, uc_affiliation, updated_at)
VALUES ('${userId}', 'E2E Tester', 'E2E', '+15555550100', 'student', ${nowMs});
`;
  execD1(sql);
}

/** Look up the current `users.status` for a given email (asserting on
 *  post-mutation DB state). */
function readStatus(email: string): string | null {
  const escapedEmail = `'${email.replace(/'/g, "''")}'`;
  const out = execD1(
    `SELECT u.status as status FROM users u JOIN user_emails ue ON ue.user_id = u.id WHERE ue.email = ${escapedEmail};`,
  );
  // wrangler d1 execute --json returns an array of result objects;
  // pluck the first row's `status` if any.
  try {
    const parsed = JSON.parse(out) as Array<{
      results: Array<{ status: string }>;
    }>;
    return parsed[0]?.results?.[0]?.status ?? null;
  } catch {
    return null;
  }
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

test("/members/registrations redirects to /members/management", async ({
  page,
  mailpit,
}) => {
  const officerEmail = `e2e-officer-redirect-${Date.now()}@example.com`;
  await signInAsOfficer(page, mailpit, officerEmail);

  await page.goto("/members/registrations");
  await page.waitForURL((u) => u.pathname === "/members/management", {
    timeout: 10_000,
  });
  await waitForHydration(page);
  // The page heading is the management UI's, not a 404 / blank stub.
  await expect(
    page.getByRole("heading", { name: /member management/i }),
  ).toBeVisible();
});

test("/members directory has no status filter dropdown", async ({
  page,
  mailpit,
}) => {
  // Officer (role_system_admin) used to see a status filter on the
  // directory; the refactor moved every non-approved status to the
  // management page so the filter shouldn't render — even for admins.
  const officerEmail = `e2e-officer-filter-${Date.now()}@example.com`;
  await signInAsOfficer(page, mailpit, officerEmail);

  await page.goto("/members");
  await waitForHydration(page);

  // Directory header copy is the simpler "Approved club members."
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

  await page.goto("/members/management?tab=rejected");
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

  // Switch to the deactivated tab.
  await page.getByRole("button", { name: /^deactivated$/i }).click();
  await page.waitForURL((u) => u.search.includes("tab=deactivated"));
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

  await page.goto("/members/management?tab=deactivated");
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
