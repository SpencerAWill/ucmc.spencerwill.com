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
 * Officer authoring on `/calendar` (issue #187).
 *
 * **The recurrence builder is the highest-consequence control in the
 * feature and had no end-to-end coverage.** Its pure functions are well
 * tested, but nothing drove the dialog — and the failure mode is not a
 * crash: an officer picks a repeat, saves, and a semester of meetings
 * lands on the wrong days, in the feed and on every subscriber's phone,
 * with no error anywhere. These assert against the stored row, because
 * what the dialog *displays* is not what subscribers get; the `rrule`
 * column is.
 *
 * Title assertions take `.first()` throughout: a recurring series
 * renders one agenda row per occurrence, so a bare text match is a
 * strict-mode violation rather than a failure. That several of these
 * found four rows on the first run is itself the expansion working.
 */

async function signInAsOfficer(page: Page, prefix: string): Promise<void> {
  const email = `${prefix}-${Date.now()}@example.com`;
  ensureApprovedUser(email, { roles: ["role_system_admin"] });
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: seedSession(email),
      url: "http://localhost:3000",
    },
  ]);
}

function readEvent(title: string) {
  return queryD1<{
    public_id: string;
    rrule: string | null;
    starts_at: number;
    visibility: string;
    kind: string;
    sequence: number;
  }>(
    `SELECT public_id, rrule, starts_at, visibility, kind, sequence
     FROM events WHERE title = ?`,
    title,
  );
}

/** Open the create dialog with a known date already selected. */
async function openNewEvent(page: Page): Promise<void> {
  await page.goto("/calendar");
  await waitForHydration(page);
  await page.getByRole("button", { name: /new event/i }).click();
  await expect(page.getByRole("heading", { name: /new event/i })).toBeVisible();
}

test("an officer creates a one-off event and it appears on the agenda", async ({
  page,
}) => {
  await signInAsOfficer(page, "e2e-author");
  const title = `E2E gear night ${Date.now()}`;

  await openNewEvent(page);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Location").fill("Campus Rec");
  await page.getByRole("button", { name: /create event/i }).click();

  await expect(page.getByText(title).first()).toBeVisible();

  const [row] = readEvent(title);
  expect(row).toBeDefined();
  // A one-off: no rule, and SEQUENCE starts at 0.
  expect(row.rrule).toBeNull();
  expect(row.sequence).toBe(0);
});

test("a weekly repeat is stored as the rule the subscriber will expand", async ({
  page,
}) => {
  await signInAsOfficer(page, "e2e-author-weekly");
  const title = `E2E weekly ${Date.now()}`;

  await openNewEvent(page);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Repeat frequency").selectOption("weekly");

  // The plain-English echo is what an officer actually reads back, so
  // it has to agree with what gets stored.
  await expect(page.getByText(/^Every week on \w+\.$/)).toBeVisible();

  await page.getByRole("button", { name: /create event/i }).click();
  await expect(page.getByText(title).first()).toBeVisible();

  const [row] = readEvent(title);
  expect(row.rrule).toBe("FREQ=WEEKLY");
});

test("an every-other-week repeat on chosen days round-trips", async ({
  page,
}) => {
  await signInAsOfficer(page, "e2e-author-fortnight");
  const title = `E2E fortnightly ${Date.now()}`;

  await openNewEvent(page);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Repeat frequency").selectOption("weekly");
  await page.getByLabel("Every").fill("2");
  await page.getByRole("button", { name: "MO", exact: true }).click();
  await page.getByRole("button", { name: "WE", exact: true }).click();

  await page.getByRole("button", { name: /create event/i }).click();
  await expect(page.getByText(title).first()).toBeVisible();

  const [row] = readEvent(title);
  // Days in calendar order regardless of click order; INTERVAL kept.
  expect(row.rrule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE");
});

test("a bounded repeat stores COUNT", async ({ page }) => {
  await signInAsOfficer(page, "e2e-author-count");
  const title = `E2E bounded ${Date.now()}`;

  await openNewEvent(page);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Repeat frequency").selectOption("weekly");
  await page.getByLabel("Repeat ends").selectOption("count");
  await page.getByLabel("Number of occurrences").fill("6");

  await page.getByRole("button", { name: /create event/i }).click();
  await expect(page.getByText(title).first()).toBeVisible();

  expect(readEvent(title)[0].rrule).toBe("FREQ=WEEKLY;COUNT=6");
});

test("an officers-only event is stored at that visibility", async ({
  page,
}) => {
  await signInAsOfficer(page, "e2e-author-exec");
  const title = `E2E exec ${Date.now()}`;

  await openNewEvent(page);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Who can see it").selectOption("officers");
  await page.getByLabel("Type", { exact: true }).selectOption("exec");

  await page.getByRole("button", { name: /create event/i }).click();

  // Wait for the UI to confirm before reading the row. Reading straight
  // after the click races the mutation and finds nothing — the other
  // tests here happen to wait by asserting on the title first.
  await expect(page.getByText(title).first()).toBeVisible();
  // Badged wherever it appears, so an officer on a shared screen knows
  // at a glance that a row is not something the room can see.
  await expect(page.getByText("Officers only").first()).toBeVisible();

  const [row] = readEvent(title);
  expect(row.visibility).toBe("officers");
  expect(row.kind).toBe("exec");
});

test("editing a series bumps SEQUENCE and does not move its anchor", async ({
  page,
}) => {
  await signInAsOfficer(page, "e2e-author-edit");
  const title = `E2E editable ${Date.now()}`;

  await openNewEvent(page);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Repeat frequency").selectOption("weekly");
  await page.getByRole("button", { name: /create event/i }).click();
  await expect(page.getByText(title).first()).toBeVisible();

  const before = readEvent(title)[0];

  // Open a LATER occurrence than the anchor, then make an unrelated
  // edit. The anchor must not follow the occurrence that was open.
  const rows = page.getByRole("link", { name: new RegExp(title) });
  await rows.nth(Math.min(1, (await rows.count()) - 1)).click();
  await page.getByRole("button", { name: /edit series/i }).click();

  const renamed = `${title} renamed`;
  await page.getByLabel("Title").fill(renamed);
  await page.getByRole("button", { name: /save changes/i }).click();

  await expect(page.getByText(renamed).first()).toBeVisible();

  const after = readEvent(renamed)[0];
  expect(after.public_id).toBe(before.public_id);
  // Clients ignore a VEVENT that doesn't beat the copy they hold.
  expect(after.sequence).toBeGreaterThan(before.sequence);
  // The bug this pins: seeding the dialog from the open occurrence
  // silently re-anchored the series and deleted everything before it.
  expect(after.starts_at).toBe(before.starts_at);
  expect(after.rrule).toBe(before.rrule);
});

test("a member sees no authoring affordances", async ({ page }) => {
  const email = `e2e-author-member-${Date.now()}@example.com`;
  ensureApprovedUser(email, { roles: ["role_member"] });
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: seedSession(email),
      url: "http://localhost:3000",
    },
  ]);

  await page.goto("/calendar");
  await waitForHydration(page);

  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await expect(page.getByRole("button", { name: /new event/i })).toHaveCount(0);
});
