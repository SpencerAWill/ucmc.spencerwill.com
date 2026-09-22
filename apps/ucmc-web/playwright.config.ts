import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Mailpit sidecar from .devcontainer/docker-compose.yml. Tests poll it for
// magic-link tokens during the sign-in flow; the dev server is configured
// (via apps/ucmc-web/.env.local) to route emails here when RESEND_API_KEY is
// absent. Reachable from inside the devcontainer at the Docker network
// hostname; default works for `pnpm e2e` invoked from the workspace.
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://mailpit:8025";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

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
      // The mobile spec is the mobile projects' business. Without this
      // it would also run at 1280px, where it passes trivially and
      // says nothing.
      testIgnore: /mobile-.*\.spec\.ts/,
    },
    /*
     * Two mobile projects, and `testMatch` confines both to the
     * `mobile-*` specs rather than re-running the whole suite at phone
     * width. That is not thrift — most of the suite is *hostile* to it.
     * `gear-scanner.spec.ts` launches its own Chromium with fake-camera
     * flags and would ignore the project's device entirely; the passkey
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
      testMatch: /mobile-.*\.spec\.ts/,
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testMatch: /mobile-.*\.spec\.ts/,
    },
  ],

  // Boots the dev server for the test run. `reuseExistingServer` lets a
  // dev who already has `pnpm dev` running skip the cold-start cost.
  webServer: {
    command: "pnpm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
    env: {
      MAILPIT_URL,
      // Disable Turnstile in e2e — the widget polls Cloudflare's CDN
      // continuously, blocking `networkidle` and stealing focus from
      // the email input mid-keystroke. Empty string overrides
      // .env.local; the form skips rendering the widget when unset and
      // the server skips verification (per CLAUDE.md auth notes).
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
