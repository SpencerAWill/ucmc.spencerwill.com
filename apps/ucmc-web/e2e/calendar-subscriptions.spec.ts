import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  SESSION_COOKIE_NAME,
  ensureApprovedUser,
  queryD1,
  seedSession,
} from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";

/**
 * `/my/calendar` — minting, filtering and revoking subscription links.
 *
 * The actions are unit-tested; what needs a browser is the part that
 * handles a **bearer credential in the DOM**. A token is rendered
 * exactly once, and the assertions below are about that being true:
 * that the URL shown matches the filter the member picked, and that it
 * does not come back on a reload.
 */

async function signIn(page: Page, prefix: string): Promise<string> {
  const email = `${prefix}-${Date.now()}@example.com`;
  ensureApprovedUser(email);
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: seedSession(email),
      url: "http://localhost:3000",
    },
  ]);
  return email;
}

function liveTokens(email: string) {
  return queryD1<{ token: string; label: string | null }>(
    `SELECT cs.token as token, cs.label as label
     FROM calendar_subscriptions cs
     JOIN user_emails ue ON ue.user_id = cs.user_id
     WHERE ue.email = ? AND cs.revoked_at IS NULL`,
    email,
  );
}

test("a member mints a link and it is shown exactly once", async ({ page }) => {
  const email = await signIn(page, "e2e-sub");
  await page.goto("/my/calendar");
  await waitForHydration(page);

  await page.getByLabel(/What.s it for/i).fill("iPhone");
  await page.getByRole("button", { name: /make a link/i }).click();

  await expect(page.getByText(/your calendar link is ready/i)).toBeVisible();

  const [row] = liveTokens(email);
  expect(row).toBeDefined();
  // The URL on screen must be the one that actually works.
  await expect(page.getByText(new RegExp(row.token))).toBeVisible();
  expect(row.label).toBe("iPhone");

  /**
   * **The token must not survive a reload.** The list query carries
   * labels and timestamps and never tokens, so a member who loses the
   * link rotates rather than re-reads it — a URL rendered into every
   * page load ends up in caches and screenshots, and this one is as
   * good as a password for reading the calendar.
   */
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByText("iPhone")).toBeVisible();
  await expect(page.getByText(new RegExp(row.token))).toHaveCount(0);
});

test("a filtered link carries its filter in the URL", async ({ page }) => {
  const email = await signIn(page, "e2e-sub-filter");
  await page.goto("/my/calendar");
  await waitForHydration(page);

  await page.getByRole("button", { name: /^Trip$/ }).click();
  await expect(page.getByText(/Only trip events\./i)).toBeVisible();

  await page.getByRole("button", { name: /make a link/i }).click();
  await expect(page.getByText(/your calendar link is ready/i)).toBeVisible();

  const [row] = liveTokens(email);
  // The filter is baked into the URL, which is what lets a member
  // subscribe twice and get two separately-coloured calendars.
  await expect(
    page.getByText(new RegExp(`${row.token}\\.ics\\?kind=trip`)),
  ).toBeVisible();
  // Unnamed filtered links are labelled by their kinds, so the list is
  // readable when it holds several.
  expect(row.label).toBe("Trip");
});

test("the public feed is reachable and needs no token", async ({ page }) => {
  await signIn(page, "e2e-sub-public");
  await page.goto("/my/calendar");
  await waitForHydration(page);

  // Built, routed and tested, but previously linked from nowhere — a
  // member had nothing to hand a non-member.
  await expect(
    page.getByRole("heading", { name: /public calendar/i }),
  ).toBeVisible();
  await expect(page.getByText(/\/api\/calendar\/public\.ics/)).toBeVisible();
});

test("revoking a link kills it", async ({ page }) => {
  const email = await signIn(page, "e2e-sub-revoke");
  await page.goto("/my/calendar");
  await waitForHydration(page);

  await page.getByRole("button", { name: /make a link/i }).click();
  await expect(page.getByText(/your calendar link is ready/i)).toBeVisible();
  expect(liveTokens(email)).toHaveLength(1);

  await page.getByRole("button", { name: /revoke/i }).click();
  await page
    .getByRole("button", { name: /^revoke$/i })
    .last()
    .click();

  await expect(page.getByText(/haven.t made a calendar link/i)).toBeVisible();
  expect(liveTokens(email)).toHaveLength(0);
});
