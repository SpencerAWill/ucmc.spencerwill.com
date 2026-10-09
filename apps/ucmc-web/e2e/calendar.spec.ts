import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  SESSION_COOKIE_NAME,
  ensureApprovedUser,
  execD1,
  seedSession,
} from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";

/**
 * `/calendar` end to end (issue #187).
 *
 * **Why e2e rather than a component test.** Every defect this page has
 * actually shipped lived at a boundary jsdom cannot reach:
 *
 *   - `PlainYearMonth.toLocaleString` throwing `Mismatched calendars`
 *     during render, which took the whole page down. Nothing rendered
 *     the page in a test, so nothing caught it.
 *   - A month grid whose cells were present in the DOM and effectively
 *     unclickable, because the custom day button dropped the sizing
 *     classes that give the cell its box. It looked correct.
 *   - DayPicker deriving "today" from the runtime zone, so the worker
 *     (UTC) and the browser stamped it on different cells and the tree
 *     failed to hydrate.
 *
 * All three need a real server render, a real hydration, and real
 * layout. This spec is the net for that class — hence the console-error
 * assertions and the bounding-box check, which look paranoid and are
 * the two things that would actually have caught them.
 *
 * Signs in by seeding a session rather than walking the magic link:
 * the subject here is the calendar, not authentication.
 */

async function signIn(page: Page, prefix: string): Promise<void> {
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

/**
 * Collect page exceptions and console errors.
 *
 * A render-time throw and a hydration mismatch both surface here and
 * nowhere else — the page may still look entirely right.
 */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

/** A dated event, two days out, visible to any approved member. */
function seedEvent(title: string): string {
  const publicId = `e2e${Date.now().toString(36)}`.slice(0, 12);
  const startsAt = Date.now() + 2 * 24 * 60 * 60 * 1000;
  execD1(
    `INSERT INTO events (id, public_id, title, starts_at, ends_at, kind, visibility)
     VALUES ('evt_${publicId}', '${publicId}', '${title}', ${startsAt}, ${startsAt + 3600000}, 'meeting', 'members')`,
  );
  return publicId;
}

test("renders, hydrates clean, and the grid is clickable", async ({ page }) => {
  const errors = collectPageErrors(page);
  await signIn(page, "e2e-calendar");

  await page.goto("/calendar");
  await waitForHydration(page);

  await expect(
    page.getByRole("heading", { name: "Calendar", level: 1 }),
  ).toBeVisible();

  // The month heading is the element that threw `Mismatched calendars`.
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();

  const joined = errors.join("\n");
  expect(joined).not.toMatch(/Mismatched calendars/i);
  expect(joined).not.toMatch(/hydrat/i);

  // Cells must be real, sized tap targets rather than a collapsed box
  // that renders correctly and cannot be hit.
  const day = page.getByRole("gridcell").filter({ hasText: /^15$/ }).first();
  const box = await day.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(20);
  expect(box!.height).toBeGreaterThan(20);
});

test("tapping two dates selects a range, and it lands in the URL", async ({
  page,
}) => {
  await signIn(page, "e2e-calendar-range");
  await page.goto("/calendar");
  await waitForHydration(page);

  const cell = (day: number) =>
    page
      .getByRole("gridcell")
      .filter({ hasText: new RegExp(`^${day}$`) })
      .first();

  // Tap, then tap again — never drag; see the grid component for why.
  await cell(10).click();
  await expect(page).toHaveURL(/[?&]from=\d{4}-\d{2}-10/);

  await cell(12).click();
  await expect(page).toHaveURL(/[?&]to=\d{4}-\d{2}-12/);

  await page.getByRole("button", { name: /whole month/i }).click();
  await expect(page).not.toHaveURL(/[?&]from=/);
});

test("a type filter is shareable and survives a reload", async ({ page }) => {
  await signIn(page, "e2e-calendar-filter");
  await page.goto("/calendar");
  await waitForHydration(page);

  await page.getByRole("button", { name: /^Trip$/ }).click();
  await expect(page).toHaveURL(/[?&]kind=trip/);

  // The whole point of putting it in the URL: the link reopens the view.
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: /^Trip$/ })).toHaveAttribute(
    "data-state",
    "on",
  );
});

test("an event opens at its own URL", async ({ page }) => {
  await signIn(page, "e2e-calendar-detail");
  const publicId = seedEvent("E2E weekly meeting");

  await page.goto(`/calendar/${publicId}`);
  await waitForHydration(page);

  await expect(page.getByText("E2E weekly meeting").first()).toBeVisible();
});
