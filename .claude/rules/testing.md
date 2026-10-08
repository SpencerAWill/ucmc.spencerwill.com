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

## Mutation testing

`pnpm --filter ucmc-web test:mutation` (Stryker), and a weekly job in `quality.yml`. **A report, not a gate** — `thresholds.break` is `null`. Score when it landed: 100%, 76/76 mutants killed, in about 5 seconds.

It runs against **`vitest.mutation.config.ts`, a plain-Node project that exists only for this** and is deliberately absent from `vitest.config.ts`'s `projects` (the files are already covered by the `workers` project; listing it would run them twice per `pnpm test`). The `workers` pool boots workerd and applies all 72 migrations per file, which is unaffordable once per mutant, and `@cloudflare/vitest-pool-workers` compatibility with Stryker is unverified upstream.

**Only pure modules can be mutated.** Anything importing `cloudflare:workers`, directly or transitively through `#/server/db`, cannot resolve in that project. That constraint — not a judgement about importance — is what picks the list in `stryker.config.json`.

Two configuration details that each cost a failed run:

- **`plugins: ["@stryker-mutator/vitest-runner"]` is required.** pnpm's strict `node_modules` defeats Stryker's plugin auto-discovery, which fails with "no TestRunner plugins were loaded".
- **`vitest.related` must be `false`.** It maps a mutated source file back to its tests through vitest's module graph, which does not resolve the `#/*` alias — so it finds nothing and Stryker exits with "No tests were executed".

**It found four real gaps on its first run**, all since closed, and they are the argument for keeping it: dropping either anchor from `STRICT_EMAIL_PATTERN` survived the whole suite, and without the trailing `$`, `redactEmail("alice@example.com SECRET")` logs `a***@example.com SECRET` — the exact disclosure that helper exists to prevent. Also surviving: `https?` → `https` in `URL_PATTERN` (plain-http tokens unredacted), and collapsing `month === CUTOFF.month` to `true` in the waiver cutoff, which misdates any early-in-the-month day after August by a whole club year.

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
- `e2e/fixtures/db.ts` seeds by writing the Miniflare D1 SQLite file directly through `node:sqlite` (see **Seeding cost** below). **`seedSession(email)` returns a session id that IS the `ucmc_session` cookie value** — the cookie holds the opaque id and nothing derived from it. A spec whose subject isn't sign-in should use it: several seconds faster per test, and no dependence on the Mailpit sidecar. (It used to be the only way a spec could run in CI at all; since the full suite runs there that is no longer the reason, but the speed still is.) A spec testing the sign-in flow itself still goes through the real magic link.
- `e2e/fixtures/fake-camera.ts` writes a single-frame Y4M of a QR for Chromium's `--use-file-for-fake-video-capture`. Hand-rolled (text header + planar YUV) because `qrcode` hands over the module matrix and an ffmpeg dependency for three loops is a poor trade.
- The webServer config sets `E2E_BYPASS_RATE_LIMIT=1` and clears Turnstile keys: the 10/60s budget can't cover a suite from one IP, and Turnstile blocks `networkidle` and steals focus.

**The whole suite runs in CI.** Two parallel jobs in `ci.yml`, split by browser matrix: `e2e-desktop` runs `--project=chromium` with an `axllent/mailpit` service container, and `e2e-mobile` runs the two mobile projects without one. They are parallel, so the suite costs one job's wall-clock.

**Each job selects by Playwright _project_, never by file name, and that is load-bearing.** The projects' `testMatch`/`testIgnore` already partition the suite, so a spec added tomorrow is covered by construction. The arrangement this replaced named spec files in the workflow, and that is exactly how 10 of 14 specs — every sign-in, gear-desk and member-management flow — ended up running only on a developer's laptop. **If you add a spec, do not add a workflow step for it; if you find yourself wanting to, the project config is what needs changing.**

Two details about the Mailpit sidecar in CI:

- **`MAILPIT_URL` must be `http://localhost:8025`, not the fixture's `http://mailpit:8025` default.** GitHub service containers publish to the runner's loopback; the Docker-network hostname that works in the devcontainer does not resolve on a runner.
- **The job waits on `/api/v1/info` before running specs.** GitHub starts the container but does not wait for the process inside it to bind, and the mailpit fixture clears the inbox in a `beforeEach` and throws when that request fails — so losing the race reads as an unrelated failure in whichever spec happens to run first, not as "Mailpit wasn't up".

### Seeding cost

**`e2e/fixtures/db.ts` writes the Miniflare SQLite file directly via `node:sqlite`, not through `wrangler d1 execute`.** Measured on the same machine: **1.4–4 ms** to open the file and run a statement, against **1–2.5 s** for the equivalent wrangler invocation — the CLI boot was the entire cost, never the SQL. Across the ~25 seed call sites that took the local chromium suite from **116 s to 82 s**, and the mobile pair runs in 48 s.

Three things make this safe, and each is worth knowing before changing the fixture:

- **The dev server does not hold an exclusive lock.** `wrangler d1 execute --local` was itself just another process opening the same file, so writing it directly is the same arrangement minus the boot. The database is in WAL mode, so an external writer and the running worker coexist; the connection sets a 5 s `timeout` to ride out the moments they overlap, since a bare `SQLITE_BUSY` would read as a flaky seed.
- **The filename is discovered, not recomputed.** Miniflare derives it as a hash internally. Reimplementing that would couple the fixtures to a private detail a miniflare bump can change silently, and the failure would look like an empty database rather than a broken fixture — so `resolveDatabaseFile()` globs the persist directory and throws if there isn't exactly one candidate.
- **Foreign keys are on by default in `node:sqlite`** (verified), which the seeds depend on: each opens with one `DELETE FROM users` and relies on `ON DELETE cascade` to clear `user_emails`, `profiles`, `sessions` and `user_roles`. Turning them off would orphan rows and the next re-seed would collide on `user_emails.email`.

**Values are bound, not interpolated.** The wrangler implementation hand-escaped every string into a SQL literal because it shipped statements to a CLI as text; prepared statements remove that. Use `queryD1<T>(sql, ...params)` for rows and `execD1(sql)` for raw multi-statement setup — `queryD1` replaced two copies of a `JSON.parse` over wrangler's `[{ results: [...] }]` envelope that each returned null for both "no rows" and "the query was broken".

**A `beforeEach` seed is no longer a performance decision.** The old guidance priced it at ~1.5–2.5 s per call; it is now microseconds-to-milliseconds. What still argues against one is state pollution, not time.

**`workers: 1` still stands.** The speed-up does nothing about isolation: all workers would share this one file, colliding on `user_emails.email`'s global UNIQUE and on each seed's delete-then-insert. Per-worker databases are issue #238, and `persistState` on `@cloudflare/vite-plugin` is the hook for it. `drizzle/seed.ts` still shells out to wrangler — that is a once-per-invocation script, where the boot does not compound.

### Seeded state

**`ensureApprovedUser` writes a current-cycle waiver attestation by default, and `attested: false` is how you opt out.**

The officer queue (`listMembersNeedingAttestationAction`) is every `status='approved'` user anti-joined against the holders of a live attestation. An approved member seeded without one therefore lands in that queue and stays there. Nothing removed them, so the local database reached **523 users, 487 of them in the queue** — and a queue that long makes `boundingBox()` return null for rows `isVisible()` reports as visible, which has already produced one false positive that looks exactly like a layout bug.

Attesting is also the realistic state: an approved member has handed in a signed waiver. A member approved who then never signed is a specific case, not the default one.

**The cycle and version are imported, never recomputed** — `currentWaiverCycle()` from `#/config/waiver-cycle` and `WAIVER_VERSION` from `#/config/legal`. The predicate in `currentAttestationFilter` is `(cycle, version, revoked_at IS NULL)`, so a hard-coded value would quietly stop matching after the Aug 21 rollover or a version bump, and the symptom would be the slow return of the pollution this prevents. (CLAUDE.md forbids deriving the club year ad-hoc regardless.) The `#/*` alias resolves inside Playwright; `e2e/fixtures/db.ts` imports `temporal-polyfill/global` itself, since nothing installs `Temporal` in the Playwright process.

**`mobile-waiver-queue.spec.ts` is the only spec that opts out**, because there the queue row _is_ the fixture.

**`e2e/global-setup.ts` sweeps the previous run's users before each invocation.** Seeds key on `${prefix}-${Date.now()}@example.com`, so every run leaves its users behind permanently; attesting stops the _queue_ growing but not the user table, since the pending, unclaimed and profile-less seeds leave rows regardless. Steady state is now ~29 users instead of unbounded growth.

Four things about the sweep are load-bearing:

- **It matches the whole `@example.com` domain, not a prefix list.** The prefixes are not a convention anyone enforces — the accumulated rows carried `mobile-overflow-`, `waiver-shift-`, `waiver-inert-`, `e2e-` and a tail of one-off debugging ones, so a prefix list would have left ~40% behind and would miss whatever the next spec invents. RFC 2606 reserves `example.com`, so no address under it can be a real mailbox. **Seed new specs under that domain or the sweep will not see them.**
- **`SEED_ADMIN_EMAIL` is excluded**, read from `process.env` and then from `.env.local` — Vite loads that file for the dev server but nothing loads it for the Playwright process, and the case that matters is a developer who pointed it at an `@example.com` address.
- **It deletes `gear_loans` rows first.** `gear_loans.member_user_id` is the one FK to `users` that is `ON DELETE RESTRICT` rather than cascade, because production must not lose the record of who holds a piece of gear. It blocks the delete outright; the first version of this sweep failed on it.
- **It deletes in chunks of 50.** The dev server is already serving by the time global setup runs, and a single 500-user cascading delete holds SQLite's write lock long enough to starve workerd — which has no busy timeout of its own and fails the request outright. Observed once as `database is locked: SQLITE_BUSY` in the worker log, taking an unrelated spec down with it.

**Sweeping happens on the way in, not on the way out**, so a failed run's rows survive for inspection.

**Known gaps, both deliberate.** Gear rows (`gear_types` / `gear_models` / `gear_items`) accumulate the same way at roughly three per run and are not swept — the ordered delete across five tables with `RESTRICT` FKs between them is a second deletion surface, and at ~60 rows it is not yet causing what the user table caused. And six approved users predating all of this carry **no `user_emails` row at all** (profiles "Dana Officer", "Riley Chen", "Sam Okafor", created 2026-09-20), so an email-keyed sweep cannot see them; they sit in the queue permanently. They were left alone because they are not attributable to any fixture.

### `smoke.spec.ts` — the only spec that runs against a real deployment

`deploy.yml` used to apply D1 migrations and push a worker to production with nothing checking the result. A deploy that 500s on every request, or one whose client bundle throws on hydration, was indistinguishable from a good one until a human loaded the site.

The smoke steps live **inside** the `web-dev` / `web-prod` jobs, not in jobs of their own: a separate job would re-run checkout, setup-node and `pnpm install` to learn something the deploy job can check directly, and would need `app_base_url` plumbed through as a job output. Inside, a smoke failure also turns the deploy red, which is what "fail loudly" has to mean.

- **`PLAYWRIGHT_BASE_URL` does double duty.** It sets `baseURL` _and_ suppresses the `webServer` block — booting `pnpm dev` against a remote target would waste two minutes and then test the wrong thing. Anything that reads `BASE_URL` must keep that coupling in mind.
- **The spec must stay read-only and unauthenticated.** It runs against production. No sign-in, no seeding, no mutation.
- **It asserts hydration, which is the half a `curl` cannot see.** SSR HTML comes back fine from a worker whose client bundle is broken — a module reaching for `cloudflare:workers` outside SSR, a chunk 404ing against a stale asset manifest — and the page then looks correct while responding to nothing. It carries the same `#main` height guard as `mobile-overflow.spec.ts`, for the same reason: an error boundary also returns 200 and hydrates.
- **`/health` is asserted through its `<h1>`, not a test id.** `report.status` is `pass` only when every probe passed, so the heading covers `d1:read`, `r2:head`, KV and the email provider in one assertion — and the page returns 200 either way, which is why curling it proves nothing. The per-probe rows are scraped into the failure message so a red deploy names the broken binding.
- **`E2E_PREVIEW=1` runs it against the production build instead of a dev server.** `webServer` becomes `pnpm build && pnpm preview`, which serves `dist/` through workerd — the artifact `wrangler deploy` ships. CI runs this on every web PR, because `vite dev` is _not_ the worker that ships: the build splits chunks, stubs `cloudflare:workers` out of the client bundle, bundles for SSR and writes an asset manifest, and dev transforms modules on demand and papers over all of it.
- **The `/health` test carries the `@deployed` tag and the build run excludes it.** Against `vite preview` the worker's outbound fetch to a loopback Mailpit **does not arrive**, while the dev server's **does** — verified both ways, so don't assume either. The email probe would therefore fail for a reason that says nothing about the build, and D1/R2/KV there are Miniflare rather than real bindings. The full smoke, tag included, runs after each deploy.
- **It is confined to its own project rather than left in `chromium`.** Against a Miniflare dev server the `/health` assertion is either vacuous or flaky depending on which local binding happens to be warm, and a smoke test that is routinely yellow on PRs stops being read on the one run that matters.

**`mobile-overflow.spec.ts` asserts one thing across every public and signed-in route: nothing makes the document wider than the viewport.** That is a whole bug class which is invisible at desktop width and unmistakable on a phone — one element reaches past the page gutter, nothing clips it, the document grows, and the _entire page_ scrolls sideways, header included, and stays that way across client-side navigations. It is easy to reintroduce because each cause (`-mx-*` that doesn't match `PageContainer`'s `px-4 sm:px-6`, a fixed `w-[Npx]`, `whitespace-nowrap` on something long) is reasonable in isolation.

The spec asserts on the **document**, not on components, which is the point: a unit test can pin the class list of the bar that caused it last time, but only a real layout tells us about the next one. Two supporting details are load-bearing. It reports the _outermost_ elements whose right edge is past the viewport, because the bare assertion otherwise leaves you bisecting a route's component tree by hand. And it first asserts `#main` is taller than 120px — **a page that rendered nothing cannot overflow, so a 404 (a page flag off, a session that didn't take) would pass while checking nothing.** Verified against the bug it was written for: restoring `AccountTabsBar`'s flat `-mx-6` fails `/my/profile` with `<div class="-mx-6 mb-6 border-b border-border"> right=398` in a 390px viewport.

**Its officer session is a worker-scoped fixture, not a `beforeEach` seed — and the reason has changed.** It was hoisted for cost: every `ensureApprovedUser` / `seedSession` call shelled out to `wrangler d1 execute`, a full CLI boot at **1.5–2.5 s locally** and slower on a runner, so seeding per test paid that twice for each of the 21 signed-in routes in each of two engines — **84 wrangler boots per CI job** against the 88 page loads they existed to enable. Hoisting took one engine from **66 s to 25.8 s** and both from ~150 s to 72 s.

**Both of its original justifications are now gone.** The boot cost went when seeding moved to `node:sqlite`; the queue pollution went when `ensureApprovedUser` started attesting by default (see **Seeded state** below). What remains is ordinary thrift — 84 seeds a run instead of 2 — plus the `workers: > 1` correctness noted in the next paragraph. That is a weaker case than it once had, and it is written down this way deliberately: if you are reading this because you want to un-hoist it, the honest answer is that nothing breaks if you do, and nothing much is gained either.

**Sharing one session is sound _for this spec_ and not in general.** Every test here is a `goto` plus a measurement — nothing writes, so there is no state for one route to leak into the next. A spec that mutates must keep seeding per test. The fixture is worker-scoped rather than a `beforeAll` so it stays correct if the suite ever runs `workers: > 1`. It needs `// eslint-disable-next-line no-empty-pattern` on `async ({}, use)`: Playwright reads the first parameter's destructured property names to resolve fixture dependencies, so the pattern has to be there even when there are none.

**`mobile-waiver-queue.spec.ts` measures layout shift, and measures it rather than asserting on markup on purpose.** Ticking a checkbox on `/members/waivers` must not move the rows: the gesture the page exists for is working down a stack of signed papers ticking rows in sequence, and the bulk-attest bar used to mount on first selection. Verified against that regression in both engines — 158px of displacement on an iPhone 14, 142px on the wider Pixel 7, because the bar stacks to a column below `sm`. Any future control that appears above the list reintroduces this whatever it is made of, which a class-list assertion would miss. The companion test pins that the bar is present-and-disabled, since "nothing moved" is also satisfied by never showing it.

Two things about _how_ it measures were each a false positive first, and both are worth knowing before writing another layout-shift test here:

- **It measures the list container, not a row.** "Did selecting a member move the list" is precisely "did anything above the list change height", and the container answers that with no dependence on which rows exist. A row-based measurement was hostage to local D1 state: `ensureApprovedUser` used to leave an approved member with no current-cycle attestation, so **every run that seeded a user added a permanent row to this queue** — the local database reached 487 of them, at which point `boundingBox()` starts returning null for a row that `isVisible()` reports as visible. That is fixed at the source now (**Seeded state** below), but keep the container-based measurement: it was the right call independently of why the rows were there, and this spec is the one that still puts rows in the queue on purpose.
- **It polls until the measurement settles** (`settledListTop`). Chromium's mobile emulation defers layout on a long list: the element is present, `toBeVisible()` passes, and `getBoundingClientRect()` reports all zeros for a beat. Reading "before" inside that window reported the whole settle as a shift — a 470px false positive on Pixel 7 that WebKit never showed. The polling is in the _setup_; the comparison stays exact to a pixel.

**`gear-scanner.spec.ts` is the only test that exercises a real decode.** The component tests stub `BarcodeScanner` wholesale and `gear-loans.spec.ts` drives the desk through the code-search combobox, so the camera → `BarcodeDetector` → ZXing WASM path had no coverage at all — which is how a stale `zxing_reader.wasm` shipped and silently decoded nothing for months. Linux Chromium has no native `BarcodeDetector`, so CI exercises the ponyfill path, the one that broke. **Both cases fail against a stale binary** — verified, and that is the point of them. `launchOptions` can't live in a `describe`, so the spec launches Chromium itself rather than splitting one file per camera frame.
