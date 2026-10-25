import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  SESSION_COOKIE_NAME,
  ensureApprovedUser,
  execD1,
  queryD1,
  seedSession,
} from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";

/**
 * Feedback from anywhere, end to end: a member sends a site bug from the
 * user menu on `/gear` with the automatic screenshot, finds it on
 * `/my/feedback`, and the image is served to them; `/feedback` is the
 * managers' area and sends everyone else to `/my/feedback`.
 *
 * Seeded rows are removed afterwards. The shared seeded-user sweep drops
 * the users, but `feedback.created_by` is `set null`, so the report would
 * otherwise pile up in the triage inbox. The screenshot object it leaves
 * in the local private bucket is what the orphan sweep is for.
 */

const stamp = Date.now();
const bugTitle = `E2E anywhere bug ${stamp}`;
const siteOnlyRoleId = `role_e2e_site_maint_${stamp}`;

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: seedSession(email),
      url: "http://localhost:3000",
    },
  ]);
}

test.beforeAll(() => {
  // A role holding site_feedback:manage and nothing club-side, for the
  // club 404 below. No seeded role has exactly that.
  execD1(
    `INSERT INTO roles (id, name, display_name, position)
       VALUES ('${siteOnlyRoleId}', 'e2e_site_maint_${stamp}', 'E2E site maintainer', 999);
     INSERT INTO role_permissions (role_id, permission_id)
       SELECT '${siteOnlyRoleId}', id FROM permissions
       WHERE name = 'site_feedback:manage';`,
  );
});

test.afterAll(() => {
  execD1(
    `DELETE FROM feedback WHERE title = '${bugTitle}';
     DELETE FROM user_roles WHERE role_id = '${siteOnlyRoleId}';
     DELETE FROM roles WHERE id = '${siteOnlyRoleId}';`,
  );
});

test("a member sends a bug with a screenshot from any page and finds it on My feedback", async ({
  page,
  browser,
}) => {
  const email = `e2e-anywhere-member-${stamp}@example.com`;
  ensureApprovedUser(email);
  await signIn(page, email);

  await page.goto("/gear");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Send feedback…" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // A member holds both submit permissions, so the dialog asks first.
  await dialog.getByRole("button", { name: /Site feedback/ }).click();
  await expect(
    dialog.getByRole("checkbox", { name: "Include screenshot" }),
  ).toBeChecked();

  await dialog.getByLabel("Title").fill(bugTitle);
  for (const label of [
    "Describe the bug",
    "Steps to reproduce",
    "Expected behavior",
  ]) {
    const editor = dialog.getByRole("textbox", { name: label });
    await editor.click();
    await editor.pressSequentially("Seeded by the anywhere e2e");
  }
  await dialog.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByText("Thanks — see it in My feedback")).toBeVisible();
  await expect(dialog).toBeHidden();

  // The report names the page it was sent from, not wherever the dialog
  // was when the button was pressed.
  const [row] = queryD1<{ id: string; page_url: string | null }>(
    "SELECT id, page_url FROM feedback WHERE title = ?",
    bugTitle,
  );
  expect(row).toBeDefined();
  expect(new URL(row.page_url ?? "").pathname).toBe("/gear");

  await page.goto("/my/feedback");
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "Website" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Club" })).toBeVisible();
  await expect(page.getByText(bugTitle)).toBeVisible();

  const image = await page.request.get(
    `/api/site-feedback/${row.id}/screenshot`,
  );
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toMatch(/^image\/(webp|jpeg)$/);
  expect(image.headers()["cache-control"]).toBe("private, no-store");
  const width = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img.naturalWidth;
  }, `/api/site-feedback/${row.id}/screenshot`);
  expect(width).toBeGreaterThan(0);
  expect(width).toBeLessThanOrEqual(1600);

  // Another member asking for the same image gets the same 404 as a
  // report that doesn't exist.
  const otherEmail = `e2e-anywhere-other-${stamp}@example.com`;
  ensureApprovedUser(otherEmail);
  const other = await browser.newContext();
  await other.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: seedSession(otherEmail),
      url: "http://localhost:3000",
    },
  ]);
  const refused = await other.request.get(
    `http://localhost:3000/api/site-feedback/${row.id}/screenshot`,
  );
  expect(refused.status()).toBe(404);
  await other.close();
});

test("a member visiting /feedback lands on /my/feedback", async ({ page }) => {
  const email = `e2e-anywhere-nonmanager-${stamp}@example.com`;
  ensureApprovedUser(email);
  await signIn(page, email);
  await page.goto("/feedback");
  await page.waitForURL(/\/my\/feedback$/);
  await expect(
    page.getByRole("heading", { name: "My feedback", level: 1 }),
  ).toBeVisible();
});

test("a maintainer visiting /feedback/site lands on triage", async ({
  page,
}) => {
  const email = `e2e-anywhere-admin-${stamp}@example.com`;
  ensureApprovedUser(email, { roles: ["role_system_admin"] });
  await signIn(page, email);
  await page.goto("/feedback/site");
  await page.waitForURL(/\/feedback\/site\/triage/);
  await expect(
    page.getByRole("heading", { name: "Triage site feedback" }),
  ).toBeVisible();
});

test("a site-only maintainer gets the 404 page at /feedback/club", async ({
  page,
}) => {
  const email = `e2e-anywhere-sitemaint-${stamp}@example.com`;
  ensureApprovedUser(email, { roles: ["role_member", siteOnlyRoleId] });
  await signIn(page, email);
  await page.goto("/feedback");
  await waitForHydration(page);
  // Reaches the area through site, and only site's card is there.
  await expect(page.getByRole("link", { name: "Triage" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Review" })).toHaveCount(0);
  await page.goto("/feedback/club");
  await expect(
    page.getByRole("heading", { name: "Page not found", level: 1 }),
  ).toBeVisible();
});
