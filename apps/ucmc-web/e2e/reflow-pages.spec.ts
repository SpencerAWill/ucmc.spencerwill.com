import type { Page } from "@playwright/test";

import {
  SESSION_COOKIE_NAME,
  ensureApprovedUser,
  execD1,
  queryD1,
} from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";
import {
  expectNoDocumentOverflow,
  resizeTo,
  settleLayout,
  test,
} from "./fixtures/reflow";

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
 * `w-[Npx]`, `whitespace-nowrap` on something long, an absolutely
 * positioned control hung outside its box) are all reasonable in
 * isolation.
 *
 * Asserting on the document rather than on any particular component is
 * the point. A unit test can pin the class list of the bar that caused
 * it last time; only a real layout can tell us about the next one.
 *
 * It used to be `mobile-overflow.spec.ts` and ran at 390 and 412px only
 * — the `mobile-*` filename put it in the phone projects and kept it out
 * of every other width (#243). It now runs wherever a project sets
 * `reflowWidths` (the `reflow-sweep` project: the 320px WCAG floor and
 * both sides of every Tailwind breakpoint), plus at each phone
 * project's own device width in both engines. See `fixtures/reflow.ts`.
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
  // The densest fixed-width surface on the site: a seven-column grid
  // that cannot reflow, a row of filter chips, and an agenda of rows
  // carrying badges and a meta line. Every one is a way for something
  // to reach past the gutter. Public since 0076, so it is checked
  // signed-OUT here — where it also renders the public-feed card, which
  // puts a long URL in a `<code>` block.
  "/calendar",
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
  "/my/calendar",
  "/my/gear",
  "/my/gear/cart",
  "/my/feedback",
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
  "/feedback",
  "/feedback/club",
  "/feedback/site",
  "/feedback/site/triage",
  // Charts are fixed-aspect SVGs with axis labels and legends — exactly
  // the content that holds its width while the column around it narrows.
  "/analytics",
  "/analytics/membership",
  "/analytics/activity",
  "/analytics/gear",
  "/analytics/compliance",
  "/analytics/platform",
] as const;

/**
 * Load `path` at the first width, then resize through the rest, checking
 * the document at each. With no `reflowWidths` (the phone projects) it
 * is one fresh load at the device's own width.
 */
async function checkAcrossWidths(page: Page, path: string, widths: number[]) {
  if (widths.length > 0) {
    await page.setViewportSize({
      width: widths[0],
      height: page.viewportSize()?.height ?? 800,
    });
  }
  await page.goto(path);
  await waitForHydration(page);
  await settleLayout(page);
  await expectNoDocumentOverflow(
    page,
    `${path} @ ${page.viewportSize()?.width}px`,
  );

  for (const width of widths.slice(1)) {
    await resizeTo(page, width);
    await expectNoDocumentOverflow(page, `${path} @ ${width}px`);
  }
}

for (const path of PUBLIC_ROUTES) {
  test(`no horizontal overflow: ${path}`, async ({ page, reflowWidths }) => {
    await checkAcrossWidths(page, path, reflowWidths);
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
    test(`no horizontal overflow: ${path}`, async ({ page, reflowWidths }) => {
      await checkAcrossWidths(page, path, reflowWidths);
    });
  }

  /**
   * `/members/$publicId` cannot sit in the list above — it needs a
   * real member to point at — and it is the one page built around
   * free text a member types about themselves, so it is where an
   * unbreakable string is most likely to widen the document.
   *
   * Seeded with deliberately hostile values: a long single-token
   * email, a name with no spaces to wrap at, and a status line that
   * runs well past one phone line. The empty profile the plain
   * fixture produces would pass this while checking nothing.
   */
  test("no horizontal overflow: /members/$publicId", async ({
    page,
    reflowWidths,
  }) => {
    const email = `overflow-profile-${Date.now()}@example.com`;
    ensureApprovedUser(email);
    const [member] = queryD1<{ userId: string; publicId: string }>(
      "SELECT u.id AS userId, u.public_id AS publicId FROM users u JOIN user_emails e ON e.user_id = u.id WHERE e.email = ?",
      email,
    );
    const userId = member.userId.replace(/'/g, "''");
    execD1(`
      UPDATE profiles SET
        preferred_name = 'Bartholomewinthroprightson',
        full_name = 'Bartholomewinthroprightson Vandersomethingorother',
        trail_name = 'Thelongestpossibletrailnameimaginable',
        pronouns = 'they/them',
        status_line = 'Looking for a caving partner in November, ideally someone who owns a vertical kit and is free most weekends'
      WHERE user_id = '${userId}';
      INSERT INTO profile_prompts (user_id, prompt_key, answer, position)
        VALUES ('${userId}', 'trail_snack', 'Supercalifragilisticexpialidociousnessandthensome', 0);
      INSERT INTO profile_disciplines (user_id, discipline, level)
        VALUES ('${userId}', 'mountaineering', 'experienced');
    `);

    await checkAcrossWidths(page, `/members/${member.publicId}`, reflowWidths);
  });
});
