import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { chromium, expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

import {
  SESSION_COOKIE_NAME,
  ensureApprovedUser,
  execD1,
  seedSession,
} from "./fixtures/db";
import { fakeCameraArgs, writeQrY4m } from "./fixtures/fake-camera";
import { waitForHydration } from "./fixtures/hydration";

/**
 * Covers the gear-desk scanner's decode seam end to end: a real camera
 * frame, through `BarcodeDetector` (the `barcode-detector` ponyfill and
 * the ZXing WASM we serve from `/zxing-wasm/`, since Chromium on Linux
 * ships no native implementation), into the desk pane's `handleScan`.
 *
 * This is the one path the rest of the suite cannot see. The component
 * tests stub `BarcodeScanner` wholesale, and `gear-loans.spec.ts` drives
 * the desk through the code-search combobox instead. That left the
 * decode layer with no coverage at all — which is how a stale
 * `zxing_reader.wasm` shipped, threw `table index is out of bounds` on
 * every frame, and silently decoded nothing for months on every browser
 * without a native detector.
 *
 * Chromium replaces the camera with a Y4M file via launch flags, so each
 * case needs its own browser. Playwright refuses `launchOptions` inside a
 * `describe` (it would force a new worker), so these launch Chromium
 * directly rather than splitting into one spec file per payload — the
 * two cases share every step but the frame.
 *
 * Sign-in is a seeded session cookie rather than a magic link, so this
 * spec needs no Mailpit and can therefore run in CI — where the whole
 * point is to catch the next stale binary before it deploys.
 *
 * Both cases encode QR rather than the CODE128 our label printer emits.
 * `handleScan` is format-agnostic — it branches on the decoded string,
 * not the symbology — and QR is both the format in the scanner's
 * whitelist that members actually present (the cart QR) and the one
 * whose decode broke. Generating CODE128 frames would need a canvas
 * dependency to render through, for no additional coverage.
 */

const FRAME_DIR = join(process.cwd(), "test-results", "fake-camera");

// Unique per run so a reused dev server doesn't collide on gear_items.code.
const RUN_TAG = Date.now().toString().slice(-5);
const GEAR_CODE = `SCN${RUN_TAG}`;
const GEAR_FRAME = writeQrY4m(GEAR_CODE, join(FRAME_DIR, "gear-code.y4m"));

// A token that was never minted. `resolveCartTokenAction` finds nothing
// in KV and answers `expired`, which is all this case needs: the toast
// only appears if the frame decoded AND the `ucmc-cart:` branch was
// taken AND the server fn round-tripped. Seeding a live KV token to
// assert the rows hydrate would test what the component tests already
// pin, at the cost of reaching into Miniflare's state from a spec.
const CART_TOKEN = `ucmc-cart:${randomUUID()}`;
const CART_FRAME = writeQrY4m(CART_TOKEN, join(FRAME_DIR, "cart-token.y4m"));

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

/**
 * Run `body` against a Chromium whose camera is `y4mPath`, already
 * signed in as a fresh officer. Launching by hand (rather than
 * `test.use({ launchOptions })`) is what lets both cases live in one
 * file; see the module comment.
 */
async function withScannerDesk(
  y4mPath: string,
  emailPrefix: string,
  body: (page: Page) => Promise<void>,
): Promise<void> {
  const email = `${emailPrefix}-${Date.now()}@example.com`;
  ensureApprovedUser(email, { roles: ["role_system_admin"] });
  const sid = seedSession(email);

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ args: fakeCameraArgs(y4mPath) });
    const context = await browser.newContext({
      baseURL: BASE_URL,
      permissions: ["camera"],
    });
    await context.addCookies([
      { name: SESSION_COOKIE_NAME, value: sid, url: BASE_URL },
    ]);
    await body(await context.newPage());
  } finally {
    await browser?.close();
  }
}

async function openDeskAndStartScanner(page: Page): Promise<void> {
  await page.goto("/gear/loans");
  await waitForHydration(page);
  await page.getByRole("button", { name: /open gear desk/i }).click();
  await expect(
    page.getByRole("heading", { name: /^gear desk$/i }),
  ).toBeVisible();
  // The scanner defaults to OFF so the permission prompt doesn't fire on
  // every Sheet open; the placeholder is the button that starts it.
  await page.getByRole("button", { name: /tap to start the scanner/i }).click();
  await expect(page.getByLabel(/camera viewfinder/i)).toBeVisible({
    timeout: 15_000,
  });
}

test("decodes a scanned code from the camera and adds the piece", async () => {
  await withScannerDesk(GEAR_FRAME.path, "e2e-scan-officer", async (page) => {
    const now = Date.now();
    const typeId = `gt_${randomUUID()}`;
    const modelId = `gm_${randomUUID()}`;
    const itemId = `gi_${randomUUID()}`;
    execD1(`
INSERT INTO gear_types (id, public_id, name, prefix, created_at, updated_at)
VALUES ('${typeId}', '${randomUUID().replace(/-/g, "").slice(0, 12)}', 'E2E Scan Type ${RUN_TAG}', 'SCN', ${now}, ${now});
INSERT INTO gear_models (id, public_id, type_id, name, tracking, created_at, updated_at)
VALUES ('${modelId}', '${randomUUID().replace(/-/g, "").slice(0, 12)}', '${typeId}', 'E2E Scan Model ${RUN_TAG}', 'coded', ${now}, ${now});
INSERT INTO gear_items (id, public_id, model_id, code, status, condition, created_at, updated_at)
VALUES ('${itemId}', '${randomUUID().replace(/-/g, "").slice(0, 12)}', '${modelId}', '${GEAR_CODE}', 'active', 'serviceable', ${now}, ${now});
`);

    await openDeskAndStartScanner(page);

    // The green pill proves the frame decoded; the items row proves the
    // decoded string reached `handleScan` and resolved to real gear.
    // Generous timeout: the ponyfill fetches and instantiates ~1 MB of
    // WASM on first use, then scans on an animation frame.
    await expect(page.getByText(`Scanned ${GEAR_CODE}`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("cell", { name: GEAR_CODE, exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/items \(1\)/i)).toBeVisible();
  });
});

test("routes a decoded cart QR to the cart-resolve branch", async () => {
  await withScannerDesk(CART_FRAME.path, "e2e-scan-cart", async (page) => {
    await openDeskAndStartScanner(page);

    await expect(page.getByText(`Scanned ${CART_TOKEN}`)).toBeVisible({
      timeout: 30_000,
    });
    // Not "No gear matches code" — that would mean the `ucmc-cart:`
    // prefix branch was missed and the token fell through to the raw
    // code lookup.
    await expect(page.getByText(/cart qr expired/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});
