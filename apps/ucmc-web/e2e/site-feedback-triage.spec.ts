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
 * Site-feedback triage, end to end: a maintainer selects two reports,
 * starts a draft, edits its title, and finds it in the rail.
 *
 * The e2e environment has no `SITE_FEEDBACK_GITHUB_*` variables, so this
 * also pins the unconfigured path: the draft is fully editable, but
 * "File on GitHub" is disabled and says why. Nothing here reaches GitHub.
 *
 * Seeded rows are removed afterwards. The shared seeded-user sweep drops
 * the users, but `feedback.created_by` is `set null`, so the reports (and
 * the issue draft linking them) would otherwise pile up in the inbox.
 */

const stamp = Date.now();
const titleA = `E2E triage report A ${stamp}`;
const titleB = `E2E triage report B ${stamp}`;
const draftTitle = `E2E draft ${stamp}`;

function seedReport(id: string, title: string, userId: string): void {
  const now = Date.now();
  execD1(
    `INSERT INTO feedback
       (id, kind, title, body, status, created_by, created_at, updated_at)
     VALUES
       ('${id}', 'bug', '${title}', 'Seeded by the triage e2e', 'open',
        '${userId}', ${now}, ${now})`,
  );
}

test.afterAll(() => {
  // Drafts first: the links cascade from either side, but the issue
  // row is what the test created and what the rail lists.
  execD1(
    `DELETE FROM site_feedback_issues WHERE id IN (
       SELECT issue_id FROM site_feedback_issue_links
       WHERE feedback_id IN ('sfb_e2e_a_${stamp}', 'sfb_e2e_b_${stamp}'));
     DELETE FROM feedback
       WHERE id IN ('sfb_e2e_a_${stamp}', 'sfb_e2e_b_${stamp}');`,
  );
});

test("a maintainer triages two reports into a draft, with filing off", async ({
  page,
}) => {
  const managerEmail = `e2e-triage-manager-${stamp}@example.com`;
  const submitterEmail = `e2e-triage-submitter-${stamp}@example.com`;
  ensureApprovedUser(managerEmail, { roles: ["role_system_admin"] });
  ensureApprovedUser(submitterEmail);

  const [submitter] = queryD1<{ user_id: string }>(
    "SELECT user_id FROM user_emails WHERE email = ?",
    submitterEmail,
  );
  expect(submitter).toBeDefined();
  seedReport(`sfb_e2e_a_${stamp}`, titleA, submitter.user_id);
  seedReport(`sfb_e2e_b_${stamp}`, titleB, submitter.user_id);

  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: seedSession(managerEmail),
      url: "http://localhost:3000",
    },
  ]);

  await page.goto("/feedback");
  await waitForHydration(page);
  await page
    .getByRole("link", { name: /^triage/i })
    .first()
    .click();
  await page.waitForURL(/\/feedback\/site\/triage/);
  await waitForHydration(page);

  await page.getByRole("checkbox", { name: `Select ${titleA}` }).check();
  await page.getByRole("checkbox", { name: `Select ${titleB}` }).check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: /new draft/i }).click();

  await page.waitForURL(/\/feedback\/site\/triage\/issues\/sfi_/);
  await waitForHydration(page);

  const title = page.getByLabel("Title");
  await title.fill(draftTitle);
  await expect(page.getByRole("status")).toHaveText("Saved");
  // "Saved" is also the idle label, so confirm against the stored row.
  await expect
    .poll(
      () =>
        queryD1<{ title: string }>(
          "SELECT title FROM site_feedback_issues WHERE title = ?",
          draftTitle,
        ).length,
    )
    .toBe(1);

  await page.getByRole("link", { name: /back to triage/i }).click();
  await page.waitForURL(/\/feedback\/site\/triage/);
  await waitForHydration(page);

  const railEntry = page.getByRole("link", { name: new RegExp(draftTitle) });
  await expect(railEntry).toBeVisible();
  await expect(railEntry).toContainText("2 reports");

  await railEntry.click();
  await waitForHydration(page);
  await expect(
    page.getByRole("button", { name: "File on GitHub" }),
  ).toBeDisabled();
  await expect(
    page.getByText("GitHub isn't configured, so filing is off."),
  ).toBeVisible();
});
