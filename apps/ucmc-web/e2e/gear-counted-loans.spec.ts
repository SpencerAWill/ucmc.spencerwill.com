import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  SESSION_COOKIE_NAME,
  ensureApprovedUser,
  execD1,
  queryD1,
  seedSession,
} from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";

/**
 * Counted checkout at the gear desk (#223): one batch carrying a coded
 * harness and six draws, then a check-in that takes five draws back via
 * a bin-label scan and leaves the loan open for the sixth.
 *
 * What only a real browser shows: the combobox's second ("Counted")
 * group is a separate query racing the code search inside cmdk, and the
 * bin label reaches the check-in pane through the keyboard-wedge
 * listener — the jsdom suite stubs both out.
 */

const RUN_TAG = Date.now().toString().slice(-5);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

test("lends a harness and six draws in one batch, then takes five back", async ({
  page,
}) => {
  const officerEmail = `e2e-counted-officer-${Date.now()}@example.com`;
  const memberEmail = `e2e-counted-borrower-${Date.now()}@example.com`;
  ensureApprovedUser(officerEmail, { roles: ["role_system_admin"] });
  ensureApprovedUser(memberEmail, { roles: ["role_member"] });
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: seedSession(officerEmail),
      url: BASE_URL,
    },
  ]);

  const now = Date.now();
  const typeId = `gt_${randomUUID()}`;
  const codedModelId = `gm_${randomUUID()}`;
  const drawsModelId = `gm_${randomUUID()}`;
  const drawsPublicId = randomUUID().replace(/-/g, "").slice(0, 12);
  const harnessCode = `CNT${RUN_TAG}`;
  const drawsName = `Draws ${RUN_TAG}`;
  execD1(`
INSERT INTO gear_types (id, public_id, name, prefix, created_at, updated_at)
VALUES ('${typeId}', '${randomUUID().replace(/-/g, "").slice(0, 12)}', 'E2E Counted Type ${RUN_TAG}', 'CNT', ${now}, ${now});
INSERT INTO gear_models (id, public_id, type_id, name, tracking, created_at, updated_at)
VALUES ('${codedModelId}', '${randomUUID().replace(/-/g, "").slice(0, 12)}', '${typeId}', 'E2E Harness ${RUN_TAG}', 'coded', ${now}, ${now});
INSERT INTO gear_items (id, public_id, model_id, code, status, condition, created_at, updated_at)
VALUES ('gi_${randomUUID()}', '${randomUUID().replace(/-/g, "").slice(0, 12)}', '${codedModelId}', '${harnessCode}', 'active', 'serviceable', ${now}, ${now});
INSERT INTO gear_models (id, public_id, type_id, name, tracking, created_at, updated_at)
VALUES ('${drawsModelId}', '${drawsPublicId}', '${typeId}', '${drawsName}', 'counted', ${now}, ${now});
INSERT INTO gear_stock_levels (model_id, condition, quantity, updated_at)
VALUES ('${drawsModelId}', 'serviceable', 10, ${now});
`);

  await page.goto("/gear/loans");
  await waitForHydration(page);
  await page.getByRole("button", { name: /open gear desk/i }).click();
  await expect(
    page.getByRole("heading", { name: /^gear desk$/i }),
  ).toBeVisible();

  // ── checkout: one harness + six draws ────────────────────────────────
  await page
    .getByRole("combobox", { name: /search by name or email/i })
    .click();
  await page.getByPlaceholder(/search by name or email/i).fill(memberEmail);
  await page
    .getByRole("option", { name: /e2e tester/i })
    .first()
    .click();

  const search = page.getByPlaceholder(/enter code \(.*press enter/i);
  await search.fill(harnessCode);
  await page.getByRole("option", { name: new RegExp(harnessCode) }).click();
  await search.fill(drawsName);
  await page.getByRole("option", { name: new RegExp(drawsName) }).click();

  // Picking from the combobox focuses the new row's quantity — the
  // officer is typing anyway.
  const qty = page.getByRole("spinbutton", {
    name: new RegExp(`quantity of ${drawsName}`, "i"),
  });
  await expect(qty).toBeFocused();
  await qty.fill("6");
  await page.getByRole("button", { name: /^check out 7 items$/i }).click();
  await expect(page.getByText(/checked out 7 pieces/i)).toBeVisible({
    timeout: 5_000,
  });

  // ── check-in: scan the bin, take five back ───────────────────────────
  await page.getByRole("button", { name: /open gear desk/i }).click();
  await page.getByRole("tab", { name: /check in/i }).click();
  await expect(
    page.getByRole("button", { name: "Handheld scanner" }),
  ).toHaveAccessibleDescription(/ready/i);
  // `~` is the wedge sentinel: a tier-1 burst, the way a gun configured
  // with a plain preamble announces itself. Terminator in the same
  // `type()` call so the last gap stays under the reducer's budget.
  await page.keyboard.type(`~ucmc-model:${drawsPublicId}\n`, { delay: 0 });
  const returning = page.getByRole("spinbutton", {
    name: new RegExp(`units of ${drawsName} returned`, "i"),
  });
  // Prefilled to everything still out.
  await expect(returning).toHaveValue("6", { timeout: 10_000 });
  await returning.fill("5");
  await expect(
    page.getByText(/1 still out — the loan stays open for it/i),
  ).toBeVisible();

  await page.getByRole("button", { name: /^check in 5 items$/i }).click();
  await expect(page.getByText(/checked in 5 pieces.*1 still out/i)).toBeVisible(
    { timeout: 5_000 },
  );

  const [loan] = queryD1<{
    quantity: number;
    quantity_returned: number;
    returned_at: number | null;
  }>(
    "SELECT quantity, quantity_returned, returned_at FROM gear_loans WHERE model_id = ?",
    drawsModelId,
  );
  expect(loan).toEqual({
    quantity: 6,
    quantity_returned: 5,
    returned_at: null,
  });
});
