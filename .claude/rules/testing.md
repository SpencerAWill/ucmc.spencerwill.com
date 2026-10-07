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

## Coverage

`pnpm --filter ucmc-web test:coverage`, and a weekly HTML artifact from `quality.yml`. **It is a report, not a gate** — there are no thresholds, on purpose: picking a number before a baseline exists picks it out of the air, and a failing threshold teaches people to write tests that execute lines rather than tests that assert things. Baseline when it landed: 47.66% of statements.

**The provider must stay `istanbul`.** V8 coverage is [unsupported in `@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/), which is where the whole server-side suite runs — switching to the faster default would silently report nothing for the half of the codebase that matters most, and the number would go _up_.

Excluded from the denominator, each for a reason: `routeTree.gen.ts` (generated), `components/ui/**` (vendored shadcn, same rationale as its knip `entry`), tests/stories/`test-support`, and `*-fns.ts` — those are one-line shells that dynamic-import their action, and tests call the action directly, so counting them measures the boundary rather than the logic.

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

## Mutation-hook cache contracts

CLAUDE.md requires every mutation to live in a `use-*.ts` hook "with a fixed cache-invalidation contract". There are 98 of them, and until recently nothing enforced the second half of that sentence. **The failure it describes is silent:** a hook that drops a key leaves the officer looking at a queue that still lists the member they just attested, so they attest them again. No error is raised, and the server did its job correctly.

Two layers, because they catch different things:

- **`src/__tests__/mutation-hook-contract.test.tsx` — structural, all 98.** Reads source (importing 98 hooks would need every server-fn module mocked and would still only observe the ones a test invoked) and asserts each one manages _some_ cache. `NO_CACHE_BY_DESIGN` is self-clearing like `KNOWN_NULLABILITY_DRIFT`: an allowlisted hook that gains a cache call fails with "remove this entry".
- **`features/waivers/api/__tests__/invalidation-contract.test.tsx` — behavioural, exact keys.** The pattern for the rest. Table-driven, so adding a hook means adding a row, and the row _is_ the contract.

**Use `expectInvalidates` from `src/test-support/invalidation-contract.tsx`.** It renders against a REAL `QueryClient` with `invalidateQueries` spied, so the hook's own `useQueryClient()` resolves through normal wiring rather than agreeing with a stub. It compares keys as a **set** — the contract is which caches refresh, not the order `Promise.all` resolved them — and waits for `isSuccess`, because a hook that invalidates after an `await` otherwise reports zero keys and passes an emptiness check.

`vitest/expect-expect` is configured with `assertFunctionNames: ["expect", "expectInvalidates"]`. **Adding another assertion helper means adding it there**, and each entry is a promise that the named function always asserts.

**Only the waivers feature has exact-key tests so far.** The remaining features are mechanical to add and are not yet done; the structural layer covers them in the meantime.

## Property-based tests (`*.property.test.ts`)

`fast-check`, in the workers pool, for pure modules whose claim is _universally quantified_: `sanitize-filename`, `redact.server.ts`, the Temporal serialization adapters. A security claim like "no input leaks a secret-shaped value" can't be settled by a fixture list, because the list contains the inputs someone already handled.

**Write the property as the invariant, not as a convenient-looking proxy.** Both of these were wrong on the first try, and fast-check shrank each to a minimal counterexample rather than a random one:

- `expect(redactEmail(e)).not.toContain(localPart)` fails on `.e@0.edu` — the local part also occurs inside the _preserved domain_.
- Scoping that check to the output's local part fails on `--@-.com` — the first character is revealed by design, so when the local part repeats it, the "hidden" tail is a substring of what's allowed to show.

Neither was a bug in the code. The real claim is **indistinguishability**: two addresses sharing a first character and a domain must produce the same output. State it that way.

**Every generator needs an anti-vacuity guard.** `redactEmail` answers `<malformed>` for anything failing its strict pattern, so a generator that drifted into producing those would satisfy every assertion while testing nothing. The tests assert the output _isn't_ `<malformed>` before asserting anything about it.

**Seeds are random on purpose.** A correct property holds for every seed; the flake a random seed produces is a wrong property, which is exactly what you want surfaced. A failure prints its seed and shrunk counterexample, so it reproduces.

**CSV bulk import is deliberately not covered here.** Its entry points are permission-gated async actions needing DB and auth setup per run — fast-check would hammer that hundreds of times per property. It needs a pure parse function extracted first.

## Time

`src/config/__tests__/club-clock.test.ts` is the only place that controls the clock, and it is worth reading before writing another date test.

**Every calendar rule here takes an injectable `now` defaulting to `Temporal.Now.instant()`, and passing one explicitly tests the arithmetic while saying nothing about the branch production uses.** A change that made the default read UTC instead of `CLUB_TIME_ZONE` — or stopped reading the clock at all — passes every test that supplies its own instant. `vi.setSystemTime` is what covers that branch.

**`vi.useFakeTimers()` does reach `Temporal` inside workerd**, because the polyfill derives `Temporal.Now` from `Date.now()`, which vitest replaces. Verified; don't assume it the other way round.

**The two kinds of date arithmetic are not interchangeable, and the split is deliberate:**

- **Exact elapsed time** (`instant.subtract({ milliseconds: DAYS * DAY_MS })`) for retention windows. The privacy-policy promise is about how long data is _kept_, so a DST transition must not change it. Calendar arithmetic would make a row survive an hour longer in March than in July.
- **Calendar arithmetic in `CLUB_TIME_ZONE`** (`toZonedDateTimeISO(CLUB_TIME_ZONE)`) for anything a human reads off a calendar: the Aug 21 waiver rollover, a loan due "end of day", the March 1 officer archive.

Using the wrong one is invisible for most of the year and wrong for a few hours around a transition — exactly the shape that reaches production. A 30-day window spanning spring-forward differs from 30 calendar days by precisely one hour, and the test pins that number rather than asserting the two are "close".

## E2E

Playwright drives a freshly-spawned dev server. Four projects: `chromium` (Desktop Chrome) runs everything, `mobile-safari` (iPhone 14 / WebKit) + `mobile-chrome` (Pixel 7) are confined by `testMatch` to the `mobile-*` specs, and `smoke` is confined to `smoke.spec.ts` and runs only after a deploy.

**That confinement is deliberate, and widening it means reckoning with two specs, not just adding a viewport.** `gear-scanner.spec.ts` launches its own Chromium with fake-camera flags and would ignore the project's device entirely; the passkey specs drive a WebAuthn virtual authenticator over CDP, which WebKit has no equivalent for. `chromium` correspondingly carries `testIgnore` for the mobile specs — at 1280px they pass trivially and say nothing.

- `e2e/fixtures/mailpit.ts` polls Mailpit for magic links.
- `e2e/fixtures/hydration.ts` — **`waitForHydration(page)` polls `window.$_TSR.hydrated`; premature interaction is the source of every flake.**
- `e2e/fixtures/db.ts` seeds via `wrangler d1 execute`. **`seedSession(email)` returns a session id that IS the `ucmc_session` cookie value** — the cookie holds the opaque id and nothing derived from it. A spec whose subject isn't sign-in should use it: several seconds faster per test, and no dependence on the Mailpit sidecar. (It used to be the only way a spec could run in CI at all; since the full suite runs there that is no longer the reason, but the speed still is.) A spec testing the sign-in flow itself still goes through the real magic link.
- `e2e/fixtures/fake-camera.ts` writes a single-frame Y4M of a QR for Chromium's `--use-file-for-fake-video-capture`. Hand-rolled (text header + planar YUV) because `qrcode` hands over the module matrix and an ffmpeg dependency for three loops is a poor trade.
- The webServer config sets `E2E_BYPASS_RATE_LIMIT=1` and clears Turnstile keys: the 10/60s budget can't cover a suite from one IP, and Turnstile blocks `networkidle` and steals focus.

**The whole suite runs in CI.** Two parallel jobs in `ci.yml`, split by browser matrix: `e2e-desktop` runs `--project=chromium` with an `axllent/mailpit` service container, and `e2e-mobile` runs the two mobile projects without one. They are parallel, so the suite costs one job's wall-clock.

**Each job selects by Playwright _project_, never by file name, and that is load-bearing.** The projects' `testMatch`/`testIgnore` already partition the suite, so a spec added tomorrow is covered by construction. The arrangement this replaced named spec files in the workflow, and that is exactly how 10 of 14 specs — every sign-in, gear-desk and member-management flow — ended up running only on a developer's laptop. **If you add a spec, do not add a workflow step for it; if you find yourself wanting to, the project config is what needs changing.**

Two details about the Mailpit sidecar in CI:

- **`MAILPIT_URL` must be `http://localhost:8025`, not the fixture's `http://mailpit:8025` default.** GitHub service containers publish to the runner's loopback; the Docker-network hostname that works in the devcontainer does not resolve on a runner.
- **The job waits on `/api/v1/info` before running specs.** GitHub starts the container but does not wait for the process inside it to bind, and the mailpit fixture clears the inbox in a `beforeEach` and throws when that request fails — so losing the race reads as an unrelated failure in whichever spec happens to run first, not as "Mailpit wasn't up".

### `smoke.spec.ts` — the only spec that runs against a real deployment

`deploy.yml` used to apply D1 migrations and push a worker to production with nothing checking the result. A deploy that 500s on every request, or one whose client bundle throws on hydration, was indistinguishable from a good one until a human loaded the site.

The smoke steps live **inside** the `web-dev` / `web-prod` jobs, not in jobs of their own: a separate job would re-run checkout, setup-node and `pnpm install` to learn something the deploy job can check directly, and would need `app_base_url` plumbed through as a job output. Inside, a smoke failure also turns the deploy red, which is what "fail loudly" has to mean.

- **`PLAYWRIGHT_BASE_URL` does double duty.** It sets `baseURL` _and_ suppresses the `webServer` block — booting `pnpm dev` against a remote target would waste two minutes and then test the wrong thing. Anything that reads `BASE_URL` must keep that coupling in mind.
- **The spec must stay read-only and unauthenticated.** It runs against production. No sign-in, no seeding, no mutation.
- **It asserts hydration, which is the half a `curl` cannot see.** SSR HTML comes back fine from a worker whose client bundle is broken — a module reaching for `cloudflare:workers` outside SSR, a chunk 404ing against a stale asset manifest — and the page then looks correct while responding to nothing. It carries the same `#main` height guard as `mobile-overflow.spec.ts`, for the same reason: an error boundary also returns 200 and hydrates.
- **`/health` is asserted through its `<h1>`, not a test id.** `report.status` is `pass` only when every probe passed, so the heading covers `d1:read`, `r2:head`, KV and the email provider in one assertion — and the page returns 200 either way, which is why curling it proves nothing. The per-probe rows are scraped into the failure message so a red deploy names the broken binding.
- **It is confined to its own project rather than left in `chromium`.** Against a Miniflare dev server the `/health` assertion is either vacuous or flaky depending on which local binding happens to be warm, and a smoke test that is routinely yellow on PRs stops being read on the one run that matters.

**`mobile-overflow.spec.ts` asserts one thing across every public and signed-in route: nothing makes the document wider than the viewport.** That is a whole bug class which is invisible at desktop width and unmistakable on a phone — one element reaches past the page gutter, nothing clips it, the document grows, and the _entire page_ scrolls sideways, header included, and stays that way across client-side navigations. It is easy to reintroduce because each cause (`-mx-*` that doesn't match `PageContainer`'s `px-4 sm:px-6`, a fixed `w-[Npx]`, `whitespace-nowrap` on something long) is reasonable in isolation.

The spec asserts on the **document**, not on components, which is the point: a unit test can pin the class list of the bar that caused it last time, but only a real layout tells us about the next one. Two supporting details are load-bearing. It reports the _outermost_ elements whose right edge is past the viewport, because the bare assertion otherwise leaves you bisecting a route's component tree by hand. And it first asserts `#main` is taller than 120px — **a page that rendered nothing cannot overflow, so a 404 (a page flag off, a session that didn't take) would pass while checking nothing.** Verified against the bug it was written for: restoring `AccountTabsBar`'s flat `-mx-6` fails `/my/profile` with `<div class="-mx-6 mb-6 border-b border-border"> right=398` in a 390px viewport.

**`mobile-waiver-queue.spec.ts` measures layout shift, and measures it rather than asserting on markup on purpose.** Ticking a checkbox on `/members/waivers` must not move the rows: the gesture the page exists for is working down a stack of signed papers ticking rows in sequence, and the bulk-attest bar used to mount on first selection. Verified against that regression in both engines — 158px of displacement on an iPhone 14, 142px on the wider Pixel 7, because the bar stacks to a column below `sm`. Any future control that appears above the list reintroduces this whatever it is made of, which a class-list assertion would miss. The companion test pins that the bar is present-and-disabled, since "nothing moved" is also satisfied by never showing it.

Two things about _how_ it measures were each a false positive first, and both are worth knowing before writing another layout-shift test here:

- **It measures the list container, not a row.** "Did selecting a member move the list" is precisely "did anything above the list change height", and the container answers that with no dependence on which rows exist. A row-based measurement was hostage to local D1 state: `ensureApprovedUser` leaves an approved member with no current-cycle attestation, so **every e2e run that seeds a user adds a row to this queue permanently** — the local DB was carrying 227 of them, at which point `boundingBox()` starts returning null for a row that `isVisible()` reports as visible.
- **It polls until the measurement settles** (`settledListTop`). Chromium's mobile emulation defers layout on a long list: the element is present, `toBeVisible()` passes, and `getBoundingClientRect()` reports all zeros for a beat. Reading "before" inside that window reported the whole settle as a shift — a 470px false positive on Pixel 7 that WebKit never showed. The polling is in the _setup_; the comparison stays exact to a pixel.

**`gear-scanner.spec.ts` is the only test that exercises a real decode.** The component tests stub `BarcodeScanner` wholesale and `gear-loans.spec.ts` drives the desk through the code-search combobox, so the camera → `BarcodeDetector` → ZXing WASM path had no coverage at all — which is how a stale `zxing_reader.wasm` shipped and silently decoded nothing for months. Linux Chromium has no native `BarcodeDetector`, so CI exercises the ponyfill path, the one that broke. **Both cases fail against a stale binary** — verified, and that is the point of them. `launchOptions` can't live in a `describe`, so the spec launches Chromium itself rather than splitting one file per camera frame.
