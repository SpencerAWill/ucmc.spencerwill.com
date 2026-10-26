import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { SESSION_COOKIE_NAME } from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";
import { expectOverlayFits, settleLayout, test } from "./fixtures/reflow";

/**
 * Every dialog, sheet and drawer reachable from a page must fit a phone.
 *
 * `reflow-pages.spec.ts` cannot see overlays at all: they are
 * `position: fixed` in a portal, so they never widen the document
 * however far they spill. What goes wrong instead is inside the overlay
 * — a dialog that runs edge to edge because a caller's `max-w-lg`
 * replaced the primitive's phone gutter, a form whose inputs touch the
 * sheet's edge, a dialog that slides sideways because one row inside it
 * doesn't wrap. `expectOverlayFits` in `fixtures/reflow.ts` checks all
 * three.
 *
 * **The overlays are discovered, not listed.** Radix stamps
 * `aria-haspopup="dialog"` on every `DialogTrigger` / `SheetTrigger` /
 * `AlertDialogTrigger`, so each page's visible triggers are the list,
 * and a dialog added tomorrow is covered by construction — the same
 * reason the CI jobs select by project rather than by file. Clicking a
 * trigger only opens its overlay; nothing is submitted, so sharing one
 * officer session across pages stays sound.
 *
 * The limit is honest: an overlay opened *programmatically* (a dropdown
 * item that sets `open`, a row action, a mutation's result) has no
 * trigger to find. Those are held by the primitives themselves — the
 * phone gutter can't be removed by a caller's className — and by the
 * lint rule that bans width utilities on `*Content`. See
 * `.claude/rules/testing-e2e.md`.
 *
 * Measured once per page, at the narrowest width the project covers:
 * an overlay that fits at 320px fits wider, because every overlay
 * width in the app is a cap, never a floor.
 */

/**
 * Signed out there is little to open beyond the mobile nav — one page
 * covers it.
 */
const PUBLIC_ROUTES = ["/"] as const;

/**
 * Signed in as the `system_admin` officer, every overlay the app has is
 * at its most reachable: the content pages grow their `Edit` dialogs,
 * the admin pages their manage sheets, and the user menu its "Send
 * Feedback" sheet on every one of them.
 */
const SIGNED_IN_ROUTES = [
  "/",
  "/about",
  "/history",
  "/album",
  "/gazette",
  "/sponsors",
  "/volunteer",
  "/calendar",
  "/resources",
  "/scholarships",
  "/policies",
  "/gear-cave",
  "/my/profile",
  "/my/details",
  "/my/contacts",
  "/my/waiver",
  "/my/security",
  "/my/preferences",
  "/my/calendar",
  "/my/gear",
  "/my/gear/cart",
  "/my/feedback",
  "/members",
  "/members/pending",
  "/members/unclaimed",
  "/members/waivers",
  "/gear",
  "/gear/loans",
  "/access",
  "/settings",
  "/feedback/site/triage",
] as const;

/**
 * Measure the overlay `open()` produced, then dismiss it.
 *
 * Returns quietly if nothing opened — some triggers are legitimately
 * inert in a given state (an empty cart's QR), and asserting otherwise
 * would make this spec a test of every opener's preconditions.
 */
async function measureOpened(
  page: Page,
  label: string,
  open: () => Promise<void>,
) {
  const overlay = page.locator('[role="dialog"], [role="alertdialog"]').last();
  await open();
  if (!(await overlay.isVisible())) {
    await overlay.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  }
  if (!(await overlay.isVisible())) {
    return false;
  }
  // Open animations slide and zoom the box; measuring mid-flight
  // reports a dialog at 95% scale or a sheet still off-screen.
  await overlay.evaluate((el) =>
    Promise.allSettled(
      el.getAnimations({ subtree: true }).map((a) => a.finished),
    ),
  );
  await settleLayout(page);
  await expectOverlayFits(page, label);

  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();

  // What was actually measured, in the HTML report — "32 passed" alone
  // can't distinguish a clean crawl from one that opened nothing.
  test.info().annotations.push({ type: "overlay", description: label });
  return true;
}

/** The name a trigger is reported by. */
async function nameOf(locator: Locator) {
  return locator.evaluate(
    (el) =>
      el.getAttribute("aria-label") ??
      el.textContent.replace(/\s+/g, " ").trim(),
  );
}

/**
 * What a trigger is deduplicated by, and whether that holds for the
 * whole run or one page.
 *
 * - **A row's trigger** (inside a `tr` or `li`) keys on its kind alone:
 *   fifty rows' "Actions for <name>" menus open one menu fifty times
 *   with different data, and the first row's is as good as any. Opening
 *   every one is what took this spec past ten minutes.
 * - **The header's** (the sidebar trigger, the user menu with "Send
 *   Feedback") is the same overlay on every page, so it is measured once
 *   per session (public, officer) per run, not once per route.
 * - Anything else keys on its name, per page.
 */
async function dedupeKey(locator: Locator, kind: string) {
  const { name, inRow, inChrome } = await locator.evaluate((el) => ({
    name:
      el.getAttribute("aria-label") ??
      el.textContent.replace(/\s+/g, " ").trim(),
    inRow: el.closest("tr, li, [role=row]") !== null,
    inChrome: el.closest("header") !== null,
  }));
  return {
    key: inRow ? `${kind}:row` : `${kind}:${name}`,
    global: inChrome,
  };
}

/** Header overlays already measured this run — see `dedupeKey`. */
const measuredChrome = new Set<string>();

/** Wait for an open menu to finish animating in, then return it. */
async function openMenu(page: Page, trigger: Locator) {
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const menu = page.getByRole("menu").last();
  await menu.waitFor();
  // Radix re-renders the items as the open animation runs; clicking
  // one mid-flight fails as "element was detached from the DOM".
  await menu.evaluate((el) =>
    Promise.allSettled(
      el.getAnimations({ subtree: true }).map((a) => a.finished),
    ),
  );
  return menu;
}

/**
 * Open every overlay reachable from the page and measure each.
 *
 * Two routes in: a visible trigger marked `aria-haspopup="dialog"`, and
 * a menu item marked the same way inside any `aria-haspopup="menu"`
 * trigger. Both are deduplicated (`dedupeKey`) so the cost scales with
 * the number of distinct overlays, not the number of rows.
 */
async function checkOverlaysOn(
  page: Page,
  path: string,
  widths: number[],
  session: "public" | "officer",
) {
  if (widths.length > 0) {
    await page.setViewportSize({
      width: widths[0],
      height: page.viewportSize()?.height ?? 800,
    });
  }
  await page.goto(path);
  await waitForHydration(page);
  await settleLayout(page);
  const at = `${path} @ ${page.viewportSize()?.width}px`;
  const seen = new Set<string>();
  const opened: string[] = [];

  const firstVisit = async (locator: Locator, kind: string) => {
    const { key, global } = await dedupeKey(locator, kind);
    // The header's overlays differ by session — the officer's sidebar
    // carries every admin entry the signed-out one lacks — so the
    // run-wide dedupe is per session, not per run.
    const set = global ? measuredChrome : seen;
    const scoped = global ? `${session}:${key}` : key;
    if (set.has(scoped)) {
      return false;
    }
    set.add(scoped);
    return true;
  };

  const triggers = page.locator(
    '[aria-haspopup="dialog"]:visible:not([disabled]):not([role="menuitem"]), [data-sidebar="trigger"]:visible',
  );
  for (let i = 0; i < (await triggers.count()); i++) {
    const trigger = triggers.nth(i);
    if (!(await firstVisit(trigger, "trigger"))) {
      continue;
    }
    const name = await nameOf(trigger);
    if (
      await measureOpened(page, `${at} → "${name}"`, async () => {
        await trigger.scrollIntoViewIfNeeded();
        await trigger.click();
      })
    ) {
      opened.push(name);
    }
  }

  const menuTriggers = page.locator(
    '[aria-haspopup="menu"]:visible:not([disabled])',
  );
  for (let i = 0; i < (await menuTriggers.count()); i++) {
    const menuTrigger = menuTriggers.nth(i);
    if (!(await firstVisit(menuTrigger, "menu"))) {
      continue;
    }
    const menu = await openMenu(page, menuTrigger);
    const items = menu.locator(
      '[role="menuitem"][aria-haspopup="dialog"]:not([data-disabled])',
    );
    const names: string[] = [];
    for (let j = 0; j < (await items.count()); j++) {
      names.push(await nameOf(items.nth(j)));
    }
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    for (const name of names) {
      if (
        await measureOpened(page, `${at} → menu → "${name}"`, async () => {
          const reopened = await openMenu(page, menuTrigger);
          await reopened
            .getByRole("menuitem", { name, exact: true })
            .first()
            .click();
        })
      ) {
        opened.push(name);
      }
    }
  }
  return opened.length;
}

for (const path of PUBLIC_ROUTES) {
  test(`overlays fit: ${path}`, async ({ page, reflowWidths }) => {
    const measured = await checkOverlaysOn(page, path, reflowWidths, "public");
    // Every page has the mobile nav sheet, and this is the first test
    // to reach it. Zero here means the crawl found no trigger at all —
    // a renamed attribute, a selector gone stale — and every other test
    // in the file would then pass while measuring nothing.
    expect(
      measured,
      "the crawl opened no overlay on / — its trigger selectors match nothing",
    ).toBeGreaterThan(0);
  });
}

test.describe("signed in as an officer", () => {
  test.beforeEach(async ({ context, baseURL, officerSession }) => {
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: officerSession,
        url: baseURL ?? "http://localhost:3000",
      },
    ]);
  });

  for (const path of SIGNED_IN_ROUTES) {
    test(`overlays fit: ${path}`, async ({ page, reflowWidths }) => {
      await checkOverlaysOn(page, path, reflowWidths, "officer");
    });
  }
});
