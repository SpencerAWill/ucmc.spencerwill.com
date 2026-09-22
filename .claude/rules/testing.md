---
paths:
  - "apps/ucmc-web/**/*.test.ts"
  - "apps/ucmc-web/**/*.test.tsx"
  - "apps/ucmc-web/e2e/**"
  - "apps/ucmc-web/test/**"
  - "apps/ucmc-web/vitest.*.config.ts"
  - "apps/ucmc-web/playwright.config.ts"
---

# Testing

`pnpm --filter ucmc-web test` runs both pools.

## `workers` pool — `*.test.ts`

`vitest.workers.config.ts`. Runs in real workerd via `@cloudflare/vitest-pool-workers` (vitest 4.x + pool 0.16.x), wired as a Vite plugin (`cloudflareTest()`) — **there is no `defineWorkersConfig` / `poolOptions.workers` in this version.**

Migrations are applied once per file via `test/apply-migrations.ts`. **Storage isolation is per file, not per test**, so any test that writes to D1 must include the relevant tables in its own `beforeEach` cleanup — `auditLog` is a common one to forget. Cookie helpers and rate-limit wrappers are `vi.mock`ed (no request context).

Tests call **action functions** (`*-actions.server.ts`) directly, not the `createServerFn` shells.

## `dom` pool — `*.test.tsx`

`vitest.dom.config.ts`. jsdom + Testing Library + user-event. `cloudflare:workers` is aliased to `test/cloudflare-workers-stub.ts`.

**Stub `useAuth` through `authStub` (`src/test-support/auth-stub.ts`), never a hand-rolled object literal.** It builds the whole hook shape from one permission list, so the predicates can't disagree with each other and a component that starts reading an existing predicate needs no test edit. Four suites had hand-rolled their own partial stubs; when `hasAnyPermission` landed with role-preview support, two failed _wholesale_ on `TypeError: hasAnyPermission is not a function` — a stub defect that says nothing about the component under test. It sits under `src/` purely so the existing `#/*` alias resolves it in both pools and in `tsc`; no app code imports it.

**When a component needs a hook member the stub lacks, add it to `authStub`** rather than spreading an override at the call site — that's the drift the stub exists to prevent.

## What a test should pin

Prefer asserting the _reason_ a thing is written the way it is, not just that it renders:

- Drive a real state change through one mounted component when the bug class is a stale closure. `hero-carousel-controls.test.tsx` drives an actual slide change, because a freshly-mounted odd slide is **not** enough — the rAF effect doesn't depend on the phase, so a reintroduced bug keeps writing the value from its first-mount closure and a mount-only assertion reads straight past it.
- Pin round trips where two halves must agree (`album-image-key.test.ts`, `logo-url.test.ts` — an R2 prefix drifted during a rename and 404'd every photo in local dev).
- Pin type-level invariants with `@ts-expect-error` where a widened return type would silently collapse a discriminated union (`landing-actions.test.ts`).
- Pin id↔name pairings that a later "tidy-up" would break (`permission-catalog.test.ts`).

## E2E

Playwright drives a freshly-spawned dev server. Three projects: `chromium` (Desktop Chrome) runs everything, and `mobile-safari` (iPhone 14 / WebKit) + `mobile-chrome` (Pixel 7) are confined by `testMatch` to the `mobile-*` specs.

**That confinement is deliberate, and widening it means reckoning with two specs, not just adding a viewport.** `gear-scanner.spec.ts` launches its own Chromium with fake-camera flags and would ignore the project's device entirely; the passkey specs drive a WebAuthn virtual authenticator over CDP, which WebKit has no equivalent for. `chromium` correspondingly carries `testIgnore` for the mobile specs — at 1280px they pass trivially and say nothing.

- `e2e/fixtures/mailpit.ts` polls Mailpit for magic links.
- `e2e/fixtures/hydration.ts` — **`waitForHydration(page)` polls `window.$_TSR.hydrated`; premature interaction is the source of every flake.**
- `e2e/fixtures/db.ts` seeds via `wrangler d1 execute`. **`seedSession(email)` returns a session id that IS the `ucmc_session` cookie value** — the cookie holds the opaque id and nothing derived from it. A spec whose subject isn't sign-in should use it: no Mailpit, so the spec can run in CI, and several seconds faster. A spec testing the sign-in flow itself still goes through the real magic link.
- `e2e/fixtures/fake-camera.ts` writes a single-frame Y4M of a QR for Chromium's `--use-file-for-fake-video-capture`. Hand-rolled (text header + planar YUV) because `qrcode` hands over the module matrix and an ffmpeg dependency for three loops is a poor trade.
- The webServer config sets `E2E_BYPASS_RATE_LIMIT=1` and clears Turnstile keys: the 10/60s budget can't cover a suite from one IP, and Turnstile blocks `networkidle` and steals focus.

`a11y.spec.ts`, `gear-scanner.spec.ts` and the `mobile-*` specs run in CI (the workflow filters on the `mobile-` prefix, so a new one is picked up without a workflow edit) (all three in the one `a11y` job, since the browser + migrations + dev-server setup is identical and a second job would pay for it twice). Everything else is local-only because it needs the Mailpit sidecar, which the workflow doesn't have.

**`mobile-overflow.spec.ts` asserts one thing across every public and signed-in route: nothing makes the document wider than the viewport.** That is a whole bug class which is invisible at desktop width and unmistakable on a phone — one element reaches past the page gutter, nothing clips it, the document grows, and the _entire page_ scrolls sideways, header included, and stays that way across client-side navigations. It is easy to reintroduce because each cause (`-mx-*` that doesn't match `PageContainer`'s `px-4 sm:px-6`, a fixed `w-[Npx]`, `whitespace-nowrap` on something long) is reasonable in isolation.

The spec asserts on the **document**, not on components, which is the point: a unit test can pin the class list of the bar that caused it last time, but only a real layout tells us about the next one. Two supporting details are load-bearing. It reports the _outermost_ elements whose right edge is past the viewport, because the bare assertion otherwise leaves you bisecting a route's component tree by hand. And it first asserts `#main` is taller than 120px — **a page that rendered nothing cannot overflow, so a 404 (a page flag off, a session that didn't take) would pass while checking nothing.** Verified against the bug it was written for: restoring `AccountTabsBar`'s flat `-mx-6` fails `/my/profile` with `<div class="-mx-6 mb-6 border-b border-border"> right=398` in a 390px viewport.

**`mobile-waiver-queue.spec.ts` measures layout shift, and measures it rather than asserting on markup on purpose.** Ticking a checkbox on `/members/waivers` must not move the rows: the gesture the page exists for is working down a stack of signed papers ticking rows in sequence, and the bulk-attest bar used to mount on first selection — 158px of displacement on a phone, verified, because the bar stacks to a column below `sm`. Any future control that appears above the list reintroduces it whatever it is made of, which a class-list assertion would miss. The companion test pins that the bar is present-and-disabled, since "nothing moved" is also satisfied by never showing it.

**`gear-scanner.spec.ts` is the only test that exercises a real decode.** The component tests stub `BarcodeScanner` wholesale and `gear-loans.spec.ts` drives the desk through the code-search combobox, so the camera → `BarcodeDetector` → ZXing WASM path had no coverage at all — which is how a stale `zxing_reader.wasm` shipped and silently decoded nothing for months. Linux Chromium has no native `BarcodeDetector`, so CI exercises the ponyfill path, the one that broke. **Both cases fail against a stale binary** — verified, and that is the point of them. `launchOptions` can't live in a `describe`, so the spec launches Chromium itself rather than splitting one file per camera frame.
