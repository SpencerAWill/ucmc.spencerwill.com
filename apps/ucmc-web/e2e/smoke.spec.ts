import { expect, test } from "@playwright/test";

import { waitForHydration } from "./fixtures/hydration";

/**
 * Post-deploy smoke test. Runs against a DEPLOYED worker via
 * `PLAYWRIGHT_BASE_URL`, from `deploy.yml`, after migrations have been
 * applied and the worker is live — see the `smoke-dev` / `smoke-prod`
 * jobs there.
 *
 * It exists because `deploy.yml` previously applied D1 migrations and
 * pushed a worker to production with nothing checking the result. A
 * deploy that 500s on every request, or one whose client bundle throws
 * on hydration, was indistinguishable from a good one until a human
 * loaded the site.
 *
 * **Confined to its own Playwright project** (`smoke`, `testMatch:
 * /smoke\.spec\.ts/`, and `chromium` carries a matching `testIgnore`),
 * so `pnpm e2e` locally and the PR jobs never run it. That is
 * deliberate: the assertions below are about a real deployment —
 * `/health` probing live D1, R2 and KV bindings — and running them
 * against a Miniflare dev server would either be vacuous or flaky,
 * depending on which local binding happened to be warm.
 *
 * **Everything here must be read-only and unauthenticated.** It runs
 * against production. No sign-in, no seeding, no mutation — the routes
 * are the three a signed-out visitor hits first, plus the health probe.
 */

// Public, unauthenticated, and not behind a page flag that an officer
// could switch off — a smoke test that can be turned off from the
// settings UI is not a smoke test. `/legal` is the canonical-PDF legal
// index (src/config/legal.ts), which is always routable.
/**
 * Hydration budget for this suite, deliberately generous.
 *
 * These tests run against a worker uploaded seconds ago, so every asset hash
 * is new and the whole JS chain is a cache miss at the edge — and Playwright
 * gives each retry a fresh context, so no attempt benefits from the previous
 * one's cache. The 2026-10-09 dev deploy lost all three attempts on `/` at the
 * 10s default while the page itself was healthy; it hydrated in ~1.5s once the
 * edge was warm.
 *
 * What this suite asserts is that the deployed bundle hydrates AT ALL, not
 * that it hydrates quickly. There is no performance budget here, and a timeout
 * tuned to double as one just fails the deploy for the wrong reason. Local and
 * preview runs keep the 10s default in `fixtures/hydration.ts`.
 */
const DEPLOYED_HYDRATION_TIMEOUT_MS = 45_000;

const PUBLIC_ROUTES = ["/", "/sign-in", "/legal"] as const;

for (const path of PUBLIC_ROUTES) {
  test(`smoke: ${path} renders and hydrates`, async ({ page }) => {
    const response = await page.goto(path);

    // `page.goto` resolves on the navigation response, so this is the
    // deployed worker's status, not a client-side route match.
    expect(response?.status(), `${path} did not return 2xx`).toBeLessThan(400);

    // Hydration is the half a curl cannot see. SSR HTML comes back fine
    // from a worker whose client bundle is broken — a module that
    // reached for `cloudflare:workers` outside SSR, a chunk that 404s
    // against a stale asset manifest — and the page then sits there
    // looking correct and responding to nothing.
    await waitForHydration(page, DEPLOYED_HYDRATION_TIMEOUT_MS);

    // A worker that renders its error boundary also returns 200 and
    // hydrates. Assert there is a real page under it: the same
    // "did anything actually render" guard `mobile-overflow.spec.ts`
    // uses, for the same reason.
    const main = page.locator("#main");
    await expect(main).toBeVisible();
    expect(
      (await main.boundingBox())?.height ?? 0,
      `${path} hydrated but #main is empty — likely an error boundary`,
    ).toBeGreaterThan(120);
  });
}

// Tagged `@deployed` because it can only be answered by a real
// deployment. The build-mode run in CI (`E2E_PREVIEW=1`, below) excludes
// it: against `vite preview` the worker's outbound fetch to a
// loopback Mailpit does not arrive, where the dev server's does —
// verified both ways — so the email probe reports `fail` for a reason
// that says nothing about the build. The infrastructure probes are also
// Miniflare there, so a `pass` would be about Miniflare rather than
// about D1, R2 and KV.
test(
  "smoke: /health reports every binding passing",
  { tag: "@deployed" },
  async ({ page }) => {
    await page.goto("/health");
    await waitForHydration(page, DEPLOYED_HYDRATION_TIMEOUT_MS);

    // The <h1> is driven by `report.status`, which health.server.ts sets to
    // "pass" only when every individual probe passed — so this single
    // assertion covers d1:read, r2:head, kv and the email provider. Pinning
    // the heading rather than adding a `data-testid` keeps the smoke test
    // from reaching into production markup to make itself easier to write.
    const heading = page.getByRole("heading", { level: 1 });

    // /health returns 200 whether the probes pass or fail — the verdict is
    // in the body, which is exactly why curling it proves nothing. Read the
    // per-probe rows first so a red deploy names the broken binding instead
    // of only reporting that the heading was wrong.
    const probes = (await page.locator("section ul > li").allInnerTexts()).join(
      "\n",
    );

    await expect(
      heading,
      `deployed worker reported unhealthy. Probes:\n${probes}`,
    ).toHaveText("All systems operational");
  },
);
