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

Playwright drives Chromium against a freshly-spawned dev server.

- `e2e/fixtures/mailpit.ts` polls Mailpit for magic links.
- `e2e/fixtures/hydration.ts` — **`waitForHydration(page)` polls `window.$_TSR.hydrated`; premature interaction is the source of every flake.**
- `e2e/fixtures/db.ts` seeds via `wrangler d1 execute`.
- The webServer config sets `E2E_BYPASS_RATE_LIMIT=1` and clears Turnstile keys: the 10/60s budget can't cover a suite from one IP, and Turnstile blocks `networkidle` and steals focus.

Only `a11y.spec.ts` runs in CI today.
