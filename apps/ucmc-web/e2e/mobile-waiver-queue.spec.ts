import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

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
 * checkbox inserted a block above the list and pushed every row down
 * under the officer's finger — 158px on a phone, since the bar stacks to
 * a column below `sm` — and un-ticking it yanked them back. The gesture
 * this page exists to support is working down a stack of signed papers
 * ticking rows in sequence, which is the worst possible time for the
 * rows to move.
 *
 * Measured rather than asserted on the class list, because the property
 * that matters is positional: any future control added above the list
 * reintroduces this whatever it is made of.
 */

/** Sign in as an officer holding `waivers:verify`, with a member in the
 *  queue.
 *
 *  `attested: false` is what puts them there, and it has to be explicit:
 *  `ensureApprovedUser` writes a current-cycle attestation by default,
 *  because an approved member *without* one sits in this queue forever
 *  and every run used to add another. This spec is the one place the
 *  queue row IS the fixture, so it opts out — the officer does not, since
 *  they only need to read the page. */
async function seedQueue(
  page: Page,
  prefix: string,
): Promise<{ selectEmail: string }> {
  const stamp = Date.now();
  const officer = `${prefix}-officer-${stamp}@example.com`;
  const selectEmail = `${prefix}-select-${stamp}@example.com`;

  ensureApprovedUser(officer, { roles: ["role_system_admin"] });
  ensureApprovedUser(selectEmail, { attested: false });

  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: seedSession(officer),
      url: "http://localhost:3000",
    },
  ]);
  await page.goto("/members/waivers");
  await waitForHydration(page);

  return { selectEmail };
}

/**
 * The queue list, and its top edge in *document* coordinates.
 *
 * Measuring the list container rather than a row inside it is what makes
 * this stable: "did selecting a member move the list" is precisely "did
 * anything above the list change height", and the container answers that
 * without any dependence on which rows exist or what order they are in.
 * Measuring a row instead made the assertion hostage to a local D1 that
 * had accumulated a couple of hundred queue rows across earlier runs.
 *
 * `getBoundingClientRect().top + scrollY` rather than Playwright's
 * `boundingBox()`: checking a box scrolls it into view, so a
 * viewport-relative measurement would move even when the document layout
 * didn't — the opposite of what this test is about. (`boundingBox()`
 * also returns null intermittently for a row in a long list while
 * `isVisible()` reports true.)
 */
function queueList(page: Page) {
  return page
    .locator("ul")
    .filter({ has: page.getByRole("checkbox") })
    .first();
}

/**
 * `listTop`, once layout has actually run.
 *
 * Chromium's mobile emulation defers layout on a long list: the element
 * is present, Playwright's `toBeVisible()` passes, and
 * `getBoundingClientRect()` still reports all zeros for a beat. Taking
 * the "before" measurement in that window and the "after" one afterwards
 * reported the whole settle as a layout shift — a 470px false positive
 * on Pixel 7 that iPhone 14 never showed, against a local D1 carrying a
 * couple of hundred accumulated queue rows.
 *
 * So: poll until two consecutive reads agree on a non-zero value. This
 * is the *setup* being made honest, not the assertion being loosened —
 * the comparison below is still exact to a pixel.
 */
function listTop(page: Page): Promise<number> {
  return queueList(page).evaluate(
    (el) => el.getBoundingClientRect().top + window.scrollY,
  );
}

async function settledListTop(page: Page): Promise<number> {
  // Driven from the test, re-resolving the locator on every poll, and
  // that re-resolution is load-bearing: hydration can REPLACE the list
  // container, and a reference captured once then goes detached, where
  // `getBoundingClientRect()` reports zeros forever and the loop can
  // never settle. (Tried it — the spec fails with "never settled".)
  //
  // `expect.poll` supplies the waiting, so there is no fixed sleep for
  // `playwright/no-wait-for-timeout` to object to. Same 4s budget and
  // same 100ms cadence as before; the predicate is still "two
  // consecutive reads agree on a non-zero value".
  let previous = -1;
  let settled = -1;

  await expect
    .poll(
      async () => {
        const current = await listTop(page);
        const agrees = current > 0 && current === previous;
        previous = current;
        if (agrees) {
          settled = current;
        }
        return agrees;
      },
      {
        timeout: 4000,
        intervals: [100],
        message: "the queue list's position never settled",
      },
    )
    .toBe(true);

  return settled;
}

test("selecting a member doesn't move the queue rows", async ({ page }) => {
  const { selectEmail } = await seedQueue(page, "waiver-shift");

  const row = page.locator("li").filter({ hasText: selectEmail }).first();
  // Wait for the row before measuring. `waitForHydration` resolves on
  // `$_TSR.hydrated`, which can land before the queue list has painted —
  // measuring then reads a document that is still short, and the
  // difference afterwards is the whole list's height rather than any
  // layout shift.
  await expect(row).toBeVisible();

  const before = await settledListTop(page);

  await row.getByRole("checkbox").check();

  // The bulk bar's label carries the count once something is selected,
  // which is the signal that it has reacted. Without waiting for it the
  // measurement could land before any re-render and pass for the wrong
  // reason.
  await expect(
    page.getByRole("button", { name: /Attest 1 selected/ }),
  ).toBeVisible();

  const after = await settledListTop(page);

  expect(
    Math.abs(after - before),
    `The queue list moved ${Math.round(after - before)}px when a member was selected.`,
  ).toBeLessThanOrEqual(1);
});

test("the bulk bar is present and inert before anything is selected", async ({
  page,
}) => {
  // The other half of the contract: "nothing moved" would also be
  // satisfied by never showing the bar, so pin that it is there and
  // disabled.
  await seedQueue(page, "waiver-inert");

  await expect(
    page.getByRole("button", { name: "Attest selected" }),
  ).toBeDisabled();
  await expect(page.getByLabel(/Optional note/)).toBeDisabled();
});
