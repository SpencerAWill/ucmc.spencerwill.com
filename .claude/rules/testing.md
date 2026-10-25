---
paths:
  - "apps/ucmc-web/**/*.test.ts"
  - "apps/ucmc-web/**/*.test.tsx"
  - "apps/ucmc-web/test/**"
  - "apps/ucmc-web/vitest.*.config.ts"
  - "apps/ucmc-web/stryker.config.json"
---

# Testing

`pnpm --filter ucmc-web test` runs both pools.
Playwright guidance is in `testing-e2e.md` and `testing-smoke.md`, which load with `e2e/**`.

## Coverage

`pnpm --filter ucmc-web test:coverage`, and a weekly HTML artifact from `quality.yml`. **It is a report, not a gate** — there are no thresholds, on purpose: picking a number before a baseline exists picks it out of the air, and a failing threshold teaches people to write tests that execute lines rather than tests that assert things. Baseline when it landed: 47.66% of statements.

**The provider must stay `istanbul`.** V8 coverage is [unsupported in `@cloudflare/vitest-plugin`](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/), which is where the whole server-side suite runs — switching to the faster default would silently report nothing for the half of the codebase that matters most, and the number would go _up_.

Excluded from the denominator, each for a reason: `routeTree.gen.ts` (generated), `components/ui/**` (vendored shadcn, same rationale as its knip `entry`), tests/stories/`test-support`, and `*-fns.ts` — those are one-line shells that dynamic-import their action, and tests call the action directly, so counting them measures the boundary rather than the logic.

## `workers` pool — `*.test.ts`

`vitest.workers.config.ts`. Runs in real workerd via `@cloudflare/vitest-plugin` (vitest 4.x + plugin 1.3.x), wired as a Vite plugin (`cloudflareTest()`) — **there is no `defineWorkersConfig` / `poolOptions.workers` in this version.**

**The package was renamed.** It was `@cloudflare/vitest-pool-workers`, which is deprecated upstream and will not receive further updates; the export map, the `cloudflareTest()` entry point and the `/types` reference are identical, so the migration was the name. Anything still importing the old name is stale.

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

## Mutation testing

`pnpm --filter ucmc-web test:mutation` (Stryker), and a weekly job in `quality.yml`. **A report, not a gate** — `thresholds.break` is `null`. Score when it landed: 100%, 76/76 mutants killed, in about 5 seconds. The list has grown since — eight modules, 396 mutants, 386 killed — so treat the figure as a reading rather than a constant, and **run it after adding a module to `mutate`**: that is where the surviving mutants that mean something show up.

It runs against **`vitest.mutation.config.ts`, a plain-Node project that exists only for this** and is deliberately absent from `vitest.config.ts`'s `projects` (the files are already covered by the `workers` project; listing it would run them twice per `pnpm test`). The `workers` pool boots workerd and applies every migration per file (78 and counting), which is unaffordable once per mutant, and `@cloudflare/vitest-plugin` compatibility with Stryker is unverified upstream.

**Only pure modules can be mutated.** Anything importing `cloudflare:workers`, directly or transitively through `#/server/db`, cannot resolve in that project. That constraint — not a judgement about importance — is what picks the list in `stryker.config.json`.

Two configuration details that each cost a failed run:

- **`plugins: ["@stryker-mutator/vitest-runner"]` is required.** pnpm's strict `node_modules` defeats Stryker's plugin auto-discovery, which fails with "no TestRunner plugins were loaded".
- **`vitest.related` must be `false`.** It maps a mutated source file back to its tests through vitest's module graph, which does not resolve the `#/*` alias — so it finds nothing and Stryker exits with "No tests were executed".

**It found four real gaps on its first run**, all since closed, and they are the argument for keeping it: dropping either anchor from `STRICT_EMAIL_PATTERN` survived the whole suite, and without the trailing `$`, `redactEmail("alice@example.com SECRET")` logs `a***@example.com SECRET` — the exact disclosure that helper exists to prevent. Also surviving: `https?` → `https` in `URL_PATTERN` (plain-http tokens unredacted), and collapsing `month === CUTOFF.month` to `true` in the then-two-part season cutoff, which misdated any early-in-the-month day after August by a whole club year. (That cutoff is now a single `ZonedDateTime.compare`, and `club-season.test.ts` still pins the two sides it found.)

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
- **Calendar arithmetic in `CLUB_TIME_ZONE`** (`toZonedDateTimeISO(CLUB_TIME_ZONE)`) for anything a human reads off a calendar: the Aug 1 season rollover, a loan due "end of day", the March 1 officer archive.

Using the wrong one is invisible for most of the year and wrong for a few hours around a transition — exactly the shape that reaches production. A 30-day window spanning spring-forward differs from 30 calendar days by precisely one hour, and the test pins that number rather than asserting the two are "close".
