import { defineConfig, devices } from "@playwright/test";

import type { ReflowOptions } from "./e2e/fixtures/reflow";

/**
 * The reflow specs (`reflow-pages`, `reflow-overlays`) assert on layout
 * at a width, which is not a phone concern — so they are matched by
 * their own name, never by `mobile-*`. Filing them under `mobile-*` is
 * how the overflow guard ended up measuring 390 and 412px and nothing
 * else (#243).
 */
const REFLOW_SPECS = /reflow-.*\.spec\.ts/;

/**
 * The two reflow specs, apart. The phone projects run the page check
 * only: an overlay's width is always a cap, never a floor, so the
 * `reflow-overlays` project at 320px is the binding case, and
 * re-crawling every dialog at 390 and 412 in two more engines cost
 * ~3.5 min for no width it doesn't already cover.
 */
const REFLOW_PAGE_SPEC = /reflow-pages\.spec\.ts/;
const REFLOW_OVERLAY_SPEC = /reflow-overlays\.spec\.ts/;

/**
 * The `reflow-sweep` widths: the WCAG 1.4.10 floor, then both sides of
 * every Tailwind breakpoint. The edges are where `sm:` / `md:` / `lg:`
 * hand a layout from stacked to side-by-side, and an off-by-one there is
 * a real failure a sweep of round numbers would step over. Narrowest
 * first: only the first gets a fresh load (see `fixtures/reflow.ts`).
 */
const REFLOW_SWEEP_WIDTHS = [320, 639, 640, 767, 768, 1023, 1024, 1279, 1280];

// An externally-supplied base URL means we are pointed at a DEPLOYED
// worker (the post-deploy smoke step in .github/actions/deploy), not at a dev server
// this config is responsible for. It therefore does double duty: it sets
// `baseURL`, and it suppresses `webServer` below — booting `pnpm dev`
// against a remote target would waste two minutes and then test the
// wrong thing.
const EXTERNAL_BASE_URL = process.env.PLAYWRIGHT_BASE_URL;

/**
 * Run against the PRODUCTION BUILD instead of the dev server.
 *
 * `vite dev` and `vite build` do not produce the same worker, and a
 * whole class of defect exists only in the second: the client-bundle
 * `cloudflare:workers` stub, SSR bundling, chunk splitting, an asset
 * manifest that doesn't match what was emitted. Dev transforms modules
 * on demand and papers over all of it, so a suite that only ever drives
 * `pnpm dev` cannot see any of it until a deploy does.
 *
 * `vite preview` serves `dist/` through workerd via
 * @cloudflare/vite-plugin — the same artifact `wrangler deploy` ships,
 * reading the `dist/server/wrangler.json` the build snapshotted.
 */
const PREVIEW = process.env.E2E_PREVIEW === "1";

const BASE_URL =
  EXTERNAL_BASE_URL ??
  (PREVIEW ? "http://localhost:4173" : "http://localhost:3000");

// Mailpit sidecar from .devcontainer/docker-compose.yml. Tests poll it for
// magic-link tokens during the sign-in flow; the dev server is configured
// (via apps/ucmc-web/.env.local) to route emails here when RESEND_API_KEY is
// absent. Reachable from inside the devcontainer at the Docker network
// hostname; default works for `pnpm e2e` invoked from the workspace.
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://mailpit:8025";

export default defineConfig<ReflowOptions>({
  testDir: "./e2e",
  // Clears users left behind by previous runs before anything starts.
  // Seeds key on `${prefix}-${Date.now()}@example.com`, so every run
  // used to leave its users in the local D1 permanently — see
  // `sweepSeededUsers` in e2e/fixtures/db.ts for why that became a
  // correctness problem rather than untidiness.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // On CI, both reporters: `github` annotates the failing line in the PR
  // diff, `html` writes the `playwright-report/` directory that the
  // workflow uploads on failure. With `github` alone that upload step
  // silently archived nothing — there was no report to collect, which
  // only became obvious once the full suite ran there and a failure
  // actually needed a trace to diagnose.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // Made available to fixtures via testInfo.project.use; tests grab it
    // from the mailpit fixture in e2e/fixtures/mailpit.ts.
    extraHTTPHeaders: {},
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // The mobile specs are the mobile projects' business, and the
      // reflow specs are `reflow-sweep`'s, which measures 1280 among
      // its widths. `smoke.spec.ts` is excluded for a different reason
      // — see the `smoke` project below.
      testIgnore: [/mobile-.*\.spec\.ts/, REFLOW_SPECS, /smoke\.spec\.ts/],
    },
    /*
     * Two mobile projects, and `testMatch` confines both to the
     * `mobile-*` specs and `reflow-pages` rather than re-running the whole suite at phone
     * width. That is not thrift — most of the suite is *hostile* to it.
     * `gear-scanner.spec.ts`'s camera cases launch their own Chromium
     * with fake-camera flags and would ignore the project's device
     * entirely — its keyboard-wedge case does not, but `testMatch`
     * selects whole files, so the exception changes nothing; the passkey
     * specs drive a WebAuthn virtual authenticator over CDP, which
     * WebKit has no equivalent for. Broadening a mobile project means
     * reckoning with those, not just adding a viewport.
     *
     * Both engines are here because they fail differently. The two
     * defects that prompted this — a bleed that overhung its container
     * and a row that scrolled on the wrong axis — are layout, and
     * reproduce in either. But `overflow` axis computation and
     * `touch-action` handling are exactly the areas where WebKit and
     * Blink have diverged before, and iOS Safari is what the membership
     * actually carries.
     */
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
      testMatch: [/mobile-.*\.spec\.ts/, REFLOW_PAGE_SPEC],
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testMatch: [/mobile-.*\.spec\.ts/, REFLOW_PAGE_SPEC],
    },
    /*
     * The page check across the width range, in one engine. The two
     * phone projects above keep a fresh page load at the widths most of
     * the membership uses, in both engines; this one covers everything
     * they don't — 320px, tablets, split-screen, a half-width laptop
     * window — by loading once at 320 and resizing up through
     * `REFLOW_SWEEP_WIDTHS`.
     *
     * One engine because a width sweep is layout, not engine behaviour,
     * and a second would double the cost for no new failure class
     * (#239 is why the cost matters). Chromium because it is the engine
     * the desktop job already carries.
     */
    {
      name: "reflow-sweep",
      use: {
        ...devices["Desktop Chrome"],
        reflowWidths: REFLOW_SWEEP_WIDTHS,
      },
      testMatch: REFLOW_PAGE_SPEC,
    },
    /*
     * Every overlay the crawl can open, at the 320px floor. Its own
     * project rather than a second file in `reflow-sweep` so CI can give
     * each a runner by project: `--shard` balances by test count and
     * left one shard holding both files and the other empty.
     */
    {
      name: "reflow-overlays",
      use: {
        ...devices["Desktop Chrome"],
        reflowWidths: [REFLOW_SWEEP_WIDTHS[0]],
      },
      testMatch: REFLOW_OVERLAY_SPEC,
    },
    /*
     * Post-deploy smoke. Selected explicitly (`--project=smoke`) by the
     * deploy action's smoke step (.github/actions/deploy), against a real
     * worker via PLAYWRIGHT_BASE_URL; `chromium` carries the matching
     * `testIgnore` so `pnpm e2e` and the PR jobs never pick it up.
     *
     * Confining it is the point, not thrift. The spec asserts that
     * `/health` finds live D1, R2 and KV bindings — against a Miniflare
     * dev server that assertion is either vacuous or flaky depending on
     * which local binding happens to be warm, and a smoke test that is
     * routinely yellow on PRs stops being read on the one run that
     * matters.
     */
    {
      name: "smoke",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /smoke\.spec\.ts/,
    },
  ],

  // Boots the dev server for the test run. `reuseExistingServer` lets a
  // dev who already has `pnpm dev` running skip the cold-start cost.
  //
  // Skipped entirely when PLAYWRIGHT_BASE_URL is set: the target is then
  // an already-deployed worker and there is nothing for this config to
  // start or own.
  webServer: EXTERNAL_BASE_URL
    ? undefined
    : {
        // The build is part of the command rather than a prior CI step
        // so Playwright owns readiness and teardown for both modes, and
        // so `E2E_PREVIEW=1 pnpm e2e --project=smoke` works locally with
        // no setup. The env block below is applied to the BUILD too,
        // which is what bakes the empty Turnstile key into the bundle.
        command: PREVIEW
          ? "pnpm run build && pnpm run preview"
          : "pnpm run dev",
        // A cold build is minutes, not seconds.
        timeout: PREVIEW ? 300_000 : 120_000,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          MAILPIT_URL,
          // Disable Turnstile in e2e — the widget polls Cloudflare's CDN
          // continuously, blocking `networkidle` and stealing focus from
          // the email input mid-keystroke. Empty string overrides
          // .env.local; the form skips rendering the widget when unset and
          // the server skips verification (per AGENTS.md auth notes).
          VITE_TURNSTILE_SITE_KEY: "",
          TURNSTILE_SECRET_KEY: "",
          // Bypass auth/health/upload rate limiters for the duration of the
          // suite. The passkey spec hits 6 rate-limited endpoints per run,
          // and dev-server reuse means runs share an IP bucket — without
          // the bypass the second consecutive run would trip the
          // 10 req/60 s budget. Production never sets this.
          E2E_BYPASS_RATE_LIMIT: "1",
        },
      },

  // Surfaced to fixtures via `process.env.MAILPIT_URL` — kept here so a
  // single env var controls both webServer config and test polling.
  metadata: { mailpitUrl: MAILPIT_URL },
});
