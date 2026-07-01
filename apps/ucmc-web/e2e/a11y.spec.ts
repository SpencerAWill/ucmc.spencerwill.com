import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { waitForHydration } from "./fixtures/hydration";

/**
 * WCAG 2.1 AA gate. Runs axe-core against every public + auth-entry
 * route and fails the build on any `serious` or `critical` violation —
 * the bar UC EIT 9.2.1 effectively imposes on RSO surfaces.
 *
 * `minor`/`moderate` are reported by axe but not gated, so we don't
 * block PRs on borderline contrast or color-only issues that need a
 * design judgment. Promote them as the design system stabilizes.
 *
 * Tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` cover the AA
 * conformance level. `best-practice` is left off — it's noisy and not
 * what we're conforming to.
 */
const ROUTES_UNDER_TEST = [
  "/",
  "/sign-in",
  "/register/profile",
  "/legal",
  "/disclaimer",
  "/nondiscrimination",
  "/anti-hazing",
  "/waiver",
  "/privacy",
  "/terms",
  "/about",
  "/membership",
  "/open-source",
] as const;

for (const path of ROUTES_UNDER_TEST) {
  test(`a11y: ${path} has no serious or critical axe violations`, async ({
    page,
  }) => {
    await page.goto(path);
    await waitForHydration(page);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );

    // Surface the full violation payload in the test failure so the
    // CI log explains *what* failed without needing the trace viewer.
    expect(
      blocking,
      blocking.length > 0
        ? `Serious/critical axe violations on ${path}:\n${JSON.stringify(blocking, null, 2)}`
        : "",
    ).toEqual([]);
  });
}
