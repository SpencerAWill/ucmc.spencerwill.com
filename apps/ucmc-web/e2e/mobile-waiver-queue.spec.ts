import { expect, test } from "@playwright/test";

import {
  SESSION_COOKIE_NAME,
  ensureApprovedUser,
  seedSession,
} from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";

/**
 * Selecting a member on the waiver queue must not move the list.
 *
 * The bulk-attest bar used to mount on first selection, so ticking a
 * checkbox inserted a ~76px block above the list and pushed every row
 * down under the officer's finger — and un-ticking it yanked them back.
 * The gesture this page exists to support is working down a stack of
 * signed papers ticking rows in sequence, which is the worst possible
 * time for the rows to move.
 *
 * Measured rather than asserted on the class list, because the property
 * that matters is positional: any future control added above the list
 * that appears on selection reintroduces this, whatever it is made of.
 */
test("selecting a member doesn't move the queue rows", async ({
  context,
  page,
  baseURL,
}) => {
  // A freshly approved member has no current-cycle attestation, so
  // seeding two of them puts two rows in the queue. The officer needs
  // `waivers:verify` for the checkboxes to exist at all.
  const officer = `waiver-shift-officer-${Date.now()}@example.com`;
  ensureApprovedUser(officer, { roles: ["role_system_admin"] });
  ensureApprovedUser(`waiver-shift-a-${Date.now()}@example.com`);
  ensureApprovedUser(`waiver-shift-b-${Date.now()}@example.com`);

  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: seedSession(officer),
      url: baseURL ?? "http://localhost:3000",
    },
  ]);

  await page.goto("/members/waivers");
  await waitForHydration(page);

  // The rows are the `<li>`s that carry a checkbox. Scoping the
  // checkbox lookup through them excludes the table header's "Select
  // all", which also matches on name and lives in the `sm:`-and-up
  // table that is display:none at this width.
  const rows = page.locator("li").filter({ has: page.getByRole("checkbox") });
  await expect(rows.first()).toBeVisible();
  await expect(rows.nth(1)).toBeVisible();

  // The second row, not the first: a block inserted above the list
  // moves every row, and reading a later one proves the whole list held
  // still rather than just its first entry.
  const row = rows.nth(1);
  const before = await row.boundingBox();

  await rows.first().getByRole("checkbox").check();
  // The bulk bar's label carries the count once something is selected,
  // which is the signal that the bar has reacted — without waiting for
  // it, the measurement could land before any re-render at all and pass
  // for the wrong reason.
  await expect(
    page.getByRole("button", { name: /Attest 1 selected/ }),
  ).toBeVisible();

  const after = await row.boundingBox();

  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(
    Math.abs((after?.y ?? 0) - (before?.y ?? 0)),
    `Queue rows moved ${Math.round((after?.y ?? 0) - (before?.y ?? 0))}px when a member was selected.`,
  ).toBeLessThanOrEqual(1);
});

test("the bulk bar is present and inert before anything is selected", async ({
  context,
  page,
  baseURL,
}) => {
  // The other half of the contract: "no shift" would also be satisfied
  // by never showing the bar, so pin that it is there and disabled.
  const officer = `waiver-inert-officer-${Date.now()}@example.com`;
  ensureApprovedUser(officer, { roles: ["role_system_admin"] });
  ensureApprovedUser(`waiver-inert-a-${Date.now()}@example.com`);

  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: seedSession(officer),
      url: baseURL ?? "http://localhost:3000",
    },
  ]);

  await page.goto("/members/waivers");
  await waitForHydration(page);

  await expect(
    page.getByRole("button", { name: "Attest selected" }),
  ).toBeDisabled();
  await expect(page.getByLabel(/Optional note/)).toBeDisabled();
});
