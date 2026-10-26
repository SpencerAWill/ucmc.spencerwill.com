import { expect, test as base } from "@playwright/test";
import type { Page } from "@playwright/test";

import { ensureApprovedUser, seedSession } from "./db";

/**
 * Shared machinery for the reflow specs (`reflow-*.spec.ts`).
 *
 * The contract is WCAG 2.2 SC 1.4.10 Reflow: at 320 CSS px nothing may
 * need scrolling in two dimensions. Content whose *meaning* is
 * two-dimensional (a data table, a seven-column month grid) may scroll
 * sideways, but only inside its own box — never by widening the
 * document. https://www.w3.org/WAI/WCAG22/Understanding/reflow
 */

/**
 * The widths a project measures, narrowest first. Set per project in
 * `playwright.config.ts`; empty means "the device's own width only",
 * which is what the two phone projects use.
 *
 * Only the first width gets a fresh page load. The rest are reached by
 * resizing that page, which is roughly a tenth of the cost of a `goto`
 * and is what makes a nine-width sweep affordable in CI (#239). The
 * trade is deliberate: a resize measures a re-laid-out page, not a
 * first paint, so a bug that exists only on first render at, say,
 * 768px would be missed. The phone projects keep fresh loads at the
 * widths that carry real traffic, in both engines; the sweep exists to
 * catch breakpoint hand-offs, which are layout and survive a resize.
 */
export type ReflowOptions = { reflowWidths: number[] };

/**
 * The officer session, seeded ONCE PER WORKER rather than once per test.
 *
 * Sharing one session across routes is sound for these specs and not in
 * general: every test is a `goto` plus a measurement (the overlay spec
 * opens and dismisses dialogs, which writes nothing), so there is no
 * state for one route to leak into the next. A spec that mutates must
 * keep seeding per test.
 *
 * It also stops the waiver-queue pollution `.claude/rules/testing-e2e.md`
 * documents: one seed per worker rather than one per route.
 *
 * Worker-scoped rather than a `beforeAll` so it stays correct if the
 * suite ever runs `workers: > 1` — each worker seeds its own officer.
 */
export const test = base.extend<ReflowOptions, { officerSession: string }>({
  reflowWidths: [[], { option: true }],
  officerSession: [
    // Playwright requires the first parameter to be a destructuring
    // pattern — it reads the property names to resolve fixture
    // dependencies — and this fixture depends on none.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const email = `reflow-${Date.now()}@example.com`;
      ensureApprovedUser(email, { roles: ["role_system_admin"] });
      await use(seedSession(email));
    },
    { scope: "worker" },
  ],
});

/**
 * Wait until the page has finished laying itself out, not merely
 * hydrating.
 *
 * `waitForHydration` is not enough, and this is the gap the home-page
 * carousel slipped through for months: it mounts in a `useEffect` (embla
 * can't render on the server), so at the moment hydration completes the
 * DOM still holds the server's placeholder grid — which fits. The arrows
 * that widened the document by 32px arrived one frame later, after the
 * measurement. Anything rendered client-only, fetched after mount, or
 * sized after a web font loads has the same window.
 *
 * Network idle covers client fetches and lazy chunks; `fonts.ready`
 * covers text that reflows when the face swaps in; the two animation
 * frames let effects that ran on hydration commit and lay out.
 */
export async function settleLayout(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });
}

/** Resize, then wait for anything sized by a `ResizeObserver` to settle. */
export async function resizeTo(page: Page, width: number) {
  const height = page.viewportSize()?.height ?? 800;
  await page.setViewportSize({ width, height });
  await settleLayout(page);
}

/**
 * The document-level check, plus the names of whatever caused it.
 *
 * Reporting the offending elements is most of this helper's value: the
 * bare assertion tells you a page scrolls sideways, which leaves you
 * bisecting a route's component tree by hand. `scrollWidth` on the
 * document is the symptom; the element whose right edge is past the
 * viewport is the bug.
 *
 * `clientWidth`, not `innerWidth`: under mobile emulation Chromium grows
 * `innerWidth` to the overflowing content's width (measured: 445 in a
 * 412px Pixel 7), so comparing against it would pass exactly the pages
 * this exists to fail.
 */
export async function expectNoDocumentOverflow(page: Page, label: string) {
  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const viewport = doc.clientWidth;
    const culprits: string[] = [];

    // Something inside a box that clips or scrolls sideways cannot widen
    // the document, however far its own rect runs — a carousel's
    // off-screen slides measure thousands of px wide inside their
    // `overflow-hidden` track. If that box itself overhangs, the box is
    // reported instead.
    const contained = (el: Element) => {
      for (
        let p = el.parentElement;
        p && p !== document.body;
        p = p.parentElement
      ) {
        if (getComputedStyle(p).overflowX !== "visible") {
          return true;
        }
      }
      return false;
    };

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
          !contained(el) &&
          // Only the outermost offender in a chain — a child that
          // overhangs because its parent does is a consequence, not a
          // cause.
          !(
            el.parentElement &&
            el.parentElement.getBoundingClientRect().right > viewport + 1
          )
        ) {
          culprits.push(
            `<${el.tagName.toLowerCase()} class="${String(el.className)}"> right=${Math.round(rect.right)}`,
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
  expect
    .soft(
      report.mainHeight,
      `${label} rendered almost no content (#main is ${report.mainHeight}px tall) — the route probably 404'd, so its overflow was never actually checked.`,
    )
    .toBeGreaterThan(120);

  expect
    .soft(
      report.scrollWidth,
      report.culprits.length > 0
        ? `${label} scrolls horizontally (${report.scrollWidth}px document in a ${report.viewport}px viewport). Widened by:\n  ${report.culprits.join("\n  ")}`
        : `${label} scrolls horizontally (${report.scrollWidth}px document in a ${report.viewport}px viewport).`,
    )
    .toBeLessThanOrEqual(report.viewport + 1);
}

/**
 * The minimum space between a phone-width dialog and the screen edge,
 * and between an overlay's edge and the controls inside it.
 *
 * 12, not the 16 the primitives actually use, so a control that sits a
 * pixel or two inside its padding (a focus ring offset, a `-mx-1`
 * optical nudge) doesn't fail; what this exists to catch is zero.
 */
export const OVERLAY_GUTTER_PX = 12;

/**
 * Every open overlay must (a) sit inside the viewport, (b) never scroll
 * sideways, and (c) keep its controls off its own edges.
 *
 * The document check can't see any of this. Dialogs and sheets are
 * `position: fixed` in a portal, so however badly they overflow they
 * never widen the document — they overflow *themselves*, and because
 * `DialogContent` is `overflow-y-auto`, CSS computes its `overflow-x`
 * to `auto` too and the user gets a dialog that slides sideways.
 *
 * A region that is *meant* to scroll sideways inside an overlay (a wide
 * table) opts out with `data-scroll-x` — the reflow exception for
 * genuinely two-dimensional content, made explicit at the call site.
 */
export async function expectOverlayFits(page: Page, label: string) {
  const report = await page.evaluate((gutter) => {
    const viewport = document.documentElement.clientWidth;
    const problems: string[] = [];
    const describe = (el: Element) =>
      `<${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? ` data-slot="${el.getAttribute("data-slot")}"` : ""} class="${String(el.className).slice(0, 140)}">`;

    const overlays = [
      ...document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
    ].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });

    for (const overlay of overlays) {
      const box = overlay.getBoundingClientRect();
      // Centred dialogs keep a gutter to the screen; sheets and drawers
      // are edge-anchored by design and are held to their inner padding
      // instead (below).
      const edgeAnchored =
        overlay.getAttribute("data-slot") === "sheet-content" ||
        overlay.getAttribute("data-slot") === "drawer-content" ||
        overlay.hasAttribute("data-sidebar");
      const screenGutter = edgeAnchored ? 0 : gutter;

      if (
        box.left < screenGutter - 1 ||
        box.right > viewport - screenGutter + 1
      ) {
        problems.push(
          `${describe(overlay)} spans ${Math.round(box.left)}–${Math.round(box.right)} in a ${viewport}px viewport (needs ${screenGutter}px either side)`,
        );
      }

      for (const el of [overlay, ...overlay.querySelectorAll("*")]) {
        if (el.closest("[data-scroll-x]")) {
          continue;
        }
        const style = getComputedStyle(el);
        if (
          (style.overflowX === "auto" || style.overflowX === "scroll") &&
          el.scrollWidth > el.clientWidth + 1
        ) {
          problems.push(
            `${describe(el)} scrolls sideways (${el.scrollWidth}px content in ${el.clientWidth}px)`,
          );
        }
      }

      // The mobile sidebar's nav rows are full-width tap targets whose
      // text already sits inside their own padding — their box edge is
      // not a visual edge. Its sideways scroll is still checked above.
      if (overlay.hasAttribute("data-sidebar")) {
        continue;
      }

      // Controls hugging the overlay's edge. Only the things a user
      // reads or taps: a full-bleed divider or banner image is fine.
      for (const el of overlay.querySelectorAll(
        "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select, button, [role=combobox], [role=tab], label, p, h2, h3",
      )) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || el.closest("[data-scroll-x]")) {
          continue;
        }
        // An element that is itself inside a sideways scroller would be
        // reported above; its position is that scroller's business.
        if (
          r.left < box.left + gutter - 1 ||
          r.right > box.right - gutter + 1
        ) {
          problems.push(
            `${describe(el)} at ${Math.round(r.left - box.left)}px from the overlay's left / ${Math.round(box.right - r.right)}px from its right (needs ${gutter}px)`,
          );
        }
      }
    }

    return { count: overlays.length, problems: problems.slice(0, 8) };
  }, OVERLAY_GUTTER_PX);

  expect
    .soft(report.problems, `${label}:\n  ${report.problems.join("\n  ")}`)
    .toEqual([]);
  return report.count;
}
