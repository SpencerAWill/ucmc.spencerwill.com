import { randomUUID } from "node:crypto";

import { ensureApprovedUser, execD1 } from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";
import { expect, test } from "./fixtures/mailpit";

/**
 * Officer drives the gear-desk: checks out two pieces to a member,
 * then checks them back in. The member then signs in and sees both
 * pieces under /my/gear history.
 *
 * Skips the camera path — Playwright in headless Chromium can't grant
 * camera permissions reliably and the underlying decode happens in the
 * library, not our code. The search-code combobox exercises the same
 * resolve-then-add pipeline.
 */
test("officer checks out, checks in, and the member sees the history", async ({
  page,
  mailpit,
}) => {
  const officerEmail = `e2e-loan-officer-${Date.now()}@example.com`;
  const memberEmail = `e2e-loan-borrower-${Date.now()}@example.com`;
  ensureApprovedUser(officerEmail, { roles: ["role_system_admin"] });
  ensureApprovedUser(memberEmail, { roles: ["role_member"] });

  // Seed two gear pieces directly so we exercise the loan flows in
  // isolation from the gear-creation UI (which has its own spec).
  const runTag = Date.now();
  const typeId = `gt_${randomUUID()}`;
  const typePublicId = randomUUID().replace(/-/g, "").slice(0, 12);
  const g1Id = `g_${randomUUID()}`;
  const g1PublicId = randomUUID().replace(/-/g, "").slice(0, 12);
  const g2Id = `g_${randomUUID()}`;
  const g2PublicId = randomUUID().replace(/-/g, "").slice(0, 12);
  const code1 = `LN${runTag.toString().slice(-4)}A`;
  const code2 = `LN${runTag.toString().slice(-4)}B`;

  execD1(`
INSERT INTO gear_types (id, public_id, name, prefix, created_at, updated_at)
VALUES ('${typeId}', '${typePublicId}', 'E2E Loan Type ${runTag}', 'LN', ${runTag}, ${runTag});
INSERT INTO gear (id, public_id, type_id, code, description, lifecycle, condition, created_at, updated_at)
VALUES ('${g1Id}', '${g1PublicId}', '${typeId}', '${code1}', 'Piece one', 'active', 'serviceable', ${runTag}, ${runTag});
INSERT INTO gear (id, public_id, type_id, code, description, lifecycle, condition, created_at, updated_at)
VALUES ('${g2Id}', '${g2PublicId}', '${typeId}', '${code2}', 'Piece two', 'active', 'serviceable', ${runTag}, ${runTag});
`);

  // Sign in as the officer via magic link.
  await page.goto("/sign-in");
  await waitForHydration(page);
  await page.getByRole("textbox", { name: /email/i }).fill(officerEmail);
  await page.getByRole("button", { name: /send sign-in link/i }).click();
  await expect(page.getByText(/check.*for a sign-in link/i)).toBeVisible();
  const officerLink = await mailpit.extractFirstLink(officerEmail);
  await page.goto(new URL(officerLink).pathname + new URL(officerLink).search);
  await waitForHydration(page);
  await page.getByRole("button", { name: /continue to ucmc/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/callback"), {
    timeout: 15_000,
  });

  // Open /gear/loans and the gear-desk Sheet.
  await page.goto("/gear/loans");
  await waitForHydration(page);
  await page.getByRole("button", { name: /^gear desk$/i }).click();
  await expect(
    page.getByRole("heading", { name: /^gear desk$/i }),
  ).toBeVisible();

  // CHECKOUT: pick the member, add both pieces by search, submit.
  // The member combobox is the only one labeled "Search by name or email…".
  await page
    .getByRole("combobox", { name: /search by name or email/i })
    .click();
  await page
    .getByRole("combobox", { name: /search by name or email/i })
    .fill(memberEmail);
  // The CommandItem renders the member name + email; wait for it to
  // appear before clicking.
  await page
    .getByRole("option", { name: /e2e tester/i })
    .first()
    .click();

  for (const code of [code1, code2]) {
    await page.getByRole("button", { name: /search code/i }).click();
    await page.getByPlaceholder(/enter code/i).fill(code);
    await page.getByRole("option", { name: new RegExp(code) }).click();
  }
  await page.getByRole("button", { name: /^check out 2 items$/i }).click();
  await expect(
    page.getByText(new RegExp(`checked out 2 pieces`, "i")),
  ).toBeVisible({ timeout: 5_000 });

  // CHECK IN: switch modes inside the same Sheet, scan both back in.
  await page.getByRole("button", { name: /^gear desk$/i }).click();
  await page.getByRole("tab", { name: /check in/i }).click();
  for (const code of [code1, code2]) {
    await page.getByRole("button", { name: /search code/i }).click();
    await page.getByPlaceholder(/enter code to check in/i).fill(code);
    await page.getByRole("option", { name: new RegExp(code) }).click();
  }
  await page.getByRole("button", { name: /^check in 2 items$/i }).click();
  await expect(page.getByText(/checked in 2 pieces/i)).toBeVisible({
    timeout: 5_000,
  });

  // Sign out by clearing cookies and signing in as the member.
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await waitForHydration(page);
  await page.getByRole("textbox", { name: /email/i }).fill(memberEmail);
  await page.getByRole("button", { name: /send sign-in link/i }).click();
  const memberLink = await mailpit.extractFirstLink(memberEmail);
  await page.goto(new URL(memberLink).pathname + new URL(memberLink).search);
  await waitForHydration(page);
  await page.getByRole("button", { name: /continue to ucmc/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/callback"), {
    timeout: 15_000,
  });

  // Member's /my/gear: both pieces should be in history.
  await page.goto("/my/gear");
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: /^history$/i })).toBeVisible();
  await expect(page.getByText(code1)).toBeVisible();
  await expect(page.getByText(code2)).toBeVisible();
});
