import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  SESSION_COOKIE_NAME,
  ensureApprovedUser,
  seedSession,
} from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";

/**
 * Nothing on any page may make the document wider than the viewport.
 *
 * This is the regression guard for a class of bug that is invisible on a
 * desktop and unmistakable on a phone: one element reaches past the
 * page's gutter, nothing clips it, the document grows, and now the
 * *entire page* scrolls sideways — including the header and every other
 * page you navigate to without a full reload. It is always one element,
 * it is never the element you are looking at, and it is trivial to
 * reintroduce, because the utilities that cause it (`-mx-*`, a fixed
 * `w-[Npx]`, `whitespace-nowrap` on something long) are all reasonable
 * in isolation.
 *
 * Asserting on the document rather than on any particular component is
 * the point. A unit test can pin the class list of the bar that caused
 * it last time; only a real layout can tell us about the next one.
 *
 * Runs at two phone widths in two engines — see `playwright.config.ts`
 * for why the rest of the suite doesn't.
 */

/** Public routes, reachable with no session. */
const PUBLIC_ROUTES = [
  "/",
  "/sign-in",
  "/about",
  "/membership",
  "/history",
  "/album",
  "/gazette",
  "/sponsors",
  "/volunteer",
  "/trips",
  "/resources",
  "/scholarships",
  "/policies",
  "/constitution",
  "/gear-cave",
  "/legal",
  "/disclaimer",
  "/privacy",
  "/terms",
  "/nondiscrimination",
  "/anti-hazing",
  "/waiver",
  "/open-source",
] as const;

/**
 * Signed-in routes, visited as a `system_admin` so the permission-gated
 * surfaces render their *widest* form — every column, every action
 * button, every chip. A member-level session would skip exactly the
 * dense admin tables this test exists to watch.
 */
const SIGNED_IN_ROUTES = [
  "/my/profile",
  "/my/details",
  "/my/contacts",
  "/my/waiver",
  "/my/security",
  "/my/preferences",
  "/my/gear",
  "/my/gear/cart",
  "/members",
  "/members/pending",
  "/members/unclaimed",
  "/members/rejected",
  "/members/deactivated",
  "/members/waivers",
  "/gear",
  "/gear/loans",
  "/access",
  "/settings",
  "/audit",
  "/announcements",
  "/feedback",
] as const;

/**
 * The overflow check, plus the names of whatever caused it.
 *
 * Reporting the offending elements is most of this helper's value: the
 * bare assertion tells you a page scrolls sideways, which leaves you
 * bisecting a route's component tree by hand. `scrollWidth` on the
 * document is the symptom; the element whose right edge is past the
 * viewport is the bug.
 */
async function expectNoHorizontalOverflow(page: Page, path: string) {
  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const viewport = doc.clientWidth;
    const culprits: string[] = [];

    if (doc.scrollWidth > viewport) {
      for (const el of document.querySelectorAll("*")) {
        const rect = el.getBoundingClientRect();
        // `> 1` absorbs sub-pixel rounding, which is noise rather than
        // a finding. Zero-area nodes are skipped: an absolutely
        // positioned 0×0 marker parked off-screen is not what widened
        // the document, and they otherwise bury the real culprit.
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > viewport + 1 &&
          // Only the outermost offender in a chain — a child that
          // overhangs because its parent does is a consequence, not a
          // cause.
          !(
            el.parentElement &&
            el.parentElement.getBoundingClientRect().right > viewport + 1
          )
        ) {
          culprits.push(
            `<${el.tagName.toLowerCase()} class="${el.className}"> right=${Math.round(rect.right)}`,
          );
        }
      }
    }

    return {
      scrollWidth: doc.scrollWidth,
      viewport,
      mainHeight: Math.round(
        document.querySelector("#main")?.getBoundingClientRect().height ?? 0,
      ),
      culprits: culprits.slice(0, 5),
    };
  });

  // A page that rendered nothing cannot overflow, so it would pass this
  // test while telling us nothing. Most often that means the route
  // 404'd — a page flag off, or a session that didn't take — and a
  // silently vacuous suite is worse than a failing one.
  expect(
    report.mainHeight,
    `${path} rendered almost no content (#main is ${report.mainHeight}px tall) — the route probably 404'd, so its overflow was never actually checked.`,
  ).toBeGreaterThan(120);

  expect(
    report.scrollWidth,
    report.culprits.length > 0
      ? `${path} scrolls horizontally (${report.scrollWidth}px document in a ${report.viewport}px viewport). Widened by:\n  ${report.culprits.join("\n  ")}`
      : `${path} scrolls horizontally (${report.scrollWidth}px document in a ${report.viewport}px viewport).`,
  ).toBeLessThanOrEqual(report.viewport + 1);
}

for (const path of PUBLIC_ROUTES) {
  test(`no horizontal overflow: ${path}`, async ({ page }) => {
    await page.goto(path);
    await waitForHydration(page);
    await expectNoHorizontalOverflow(page, path);
  });
}

test.describe("signed in as an officer", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    const email = `mobile-overflow-${Date.now()}@example.com`;
    ensureApprovedUser(email, { roles: ["role_system_admin"] });
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: seedSession(email),
        url: baseURL ?? "http://localhost:3000",
      },
    ]);
  });

  for (const path of SIGNED_IN_ROUTES) {
    test(`no horizontal overflow: ${path}`, async ({ page }) => {
      await page.goto(path);
      await waitForHydration(page);
      await expectNoHorizontalOverflow(page, path);
    });
  }
});
