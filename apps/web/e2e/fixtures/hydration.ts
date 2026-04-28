import type { Page } from "@playwright/test";

/**
 * Wait for TanStack Start's client-side hydration to complete before
 * interacting with the page.
 *
 * Why: TanStack Start emits an SSR'd `window.$_TSR` object that the
 * client bundle flips to `hydrated: true` once React has reconciled.
 * Filling controlled inputs *before* this point causes React to replay
 * its initial state and overwrite the DOM value, silently dropping the
 * test's input.
 *
 * After `c()` runs (hydration AND stream end), `$_TSR` is deleted from
 * the global, so an `undefined` $_TSR also means we're past hydration.
 *
 * Use this once after every page.goto() and before the first
 * interaction with controlled form fields or click handlers.
 */
export async function waitForHydration(
  page: Page,
  timeoutMs = 10_000,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const tsr = (window as unknown as { $_TSR?: { hydrated?: boolean } })
        .$_TSR;
      return typeof tsr === "undefined" || tsr.hydrated === true;
    },
    null,
    { timeout: timeoutMs },
  );
}
