# Mobile reflow audit (#243)

## Problem

Pages scrolled sideways on phones, and dialogs and sheets ran edge to edge, while `mobile-overflow.spec.ts` reported all 47 routes clean. The goal was to fix what exists and make the class hard to reintroduce.

## Decisions (agreed 2026-10-26)

| Question                  | Decision                                                                                                                                 | Why                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Narrowest supported width | **320px**                                                                                                                                | WCAG 2.2 SC 1.4.10 Reflow, and the iPhone SE at its smallest                                        |
| Width coverage            | **Hybrid**: fresh load at the phone widths in both engines; Chromium-only resize sweep at 320 and both sides of each Tailwind breakpoint | Breakpoint hand-offs are layout, not engine behaviour; resizing keeps nine widths affordable (#239) |
| Overlay regressions       | **Both**: a `size` prop with ESLint banning width classes on `*Content`, plus an e2e crawl that opens overlays                           | The crawl can't reach every overlay; the structure can't see what's inside one                      |
| Side sheets on phones     | **Full width with inner padding**                                                                                                        | Forms need the width; the gutter belongs inside                                                     |

Rejected: a global `overflow-x: hidden`/`clip` on `body`. `hidden` breaks `position: sticky`, and both hide the overflow from the guard rather than fixing it.

## Why the guard was blind

1. **Its filename decided its coverage.** `mobile-*` matched only the 390px and 412px projects.
2. **It measured before layout settled.** `waitForHydration` returns before effects mount, so the client-only home carousel was measured as its server placeholder. Measured directly: zero carousel arrows in the DOM at hydration, and a 422px document in a 390px viewport half a second later.
3. **It couldn't see overlays at all.** Fixed-position portals never widen the document.

## Findings and fixes

| Where                                                  | Width(s)              | Cause                                                                                     | Fix                                       |
| ------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| `/` photo carousel                                     | every width, +24–32px | shadcn arrows at `-left-12`/`-right-12`, outside the frame                                | Arrows inside the frame, in the primitive |
| Every signed-in page                                   | 768 (to ~950)         | `SidebarInset` flex item had no `min-w-0`                                                 | `min-w-0` on the primitive                |
| `/gear` manage buttons                                 | 640, 768              | `sm:flex` row with no `flex-wrap`                                                         | `flex-wrap`                               |
| `/audit` pagination                                    | 320                   | 7 numbered links plus prev/next ≈ 356px                                                   | `page / total` below `sm`                 |
| `/members/$publicId` prompt answer                     | 320                   | `break-words` downgraded `body`'s `wrap-anywhere`, so the min-content width didn't shrink | Removed all 6 `break-words`; ESLint ban   |
| Avatar editor, setting history, landing editor dialogs | phones                | bare `max-w-*` replaced the `calc(100%-2rem)` gutter                                      | `size` prop                               |
| Gear labels dialog                                     | phones                | `w-[min(95vw,900px)] !max-w-none`                                                         | `size="4xl"`                              |
| Send Feedback (mobile sheet)                           | phones                | the sheet has no padding; the forms assumed the dialog's `p-6`                            | `px-4 pb-6` on the sheet                  |
| Admin profile sheet                                    | phones                | form at `px-1`                                                                            | `px-4`                                    |
| Pending / audit date-range calendars                   | any                   | `months` override dropped `relative`, so the nav arrows pinned to the popover's edges     | Keep `relative`                           |
| `AlertDialogContent size="sm"` (unused)                | 320                   | bare `max-w-xs`                                                                           | `max-w-[min(20rem,calc(100%-2rem))]`      |

## Guards

- `e2e/reflow-pages.spec.ts`: the document never exceeds the viewport, in the phone projects and in `reflow-sweep`.
- `e2e/reflow-overlays.spec.ts` (its own project, at 320px): crawls `aria-haspopup="dialog"` triggers and menu items, and asserts each overlay fits, never scrolls sideways, and keeps a 12px inner gutter.
- ESLint: no width classes on `*Content`; no `break-words`.
- `overlay-gutter.test.tsx`: no size removes the phone gutter.

Details are in `.claude/rules/testing-e2e.md` § Reflow.

## CI cost

All four non-Mailpit projects in one runner came to 7.9 min locally, against 48 s before. `e2e-viewports` is now a matrix with one runner per project, so the job costs its slowest entry (about 1.6 min of specs locally) rather than the sum. The last green `main` run had `e2e-desktop` at 5.4 min and the old `e2e-mobile` at 4.0.
