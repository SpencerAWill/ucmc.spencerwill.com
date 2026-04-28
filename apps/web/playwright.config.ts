import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Mailpit sidecar from .devcontainer/docker-compose.yml. Tests poll it for
// magic-link tokens during the sign-in flow; the dev server is configured
// (via apps/web/.env.local) to route emails here when RESEND_API_KEY is
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
