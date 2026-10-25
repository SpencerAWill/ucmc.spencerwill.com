---
paths:
  - "apps/ucmc-web/e2e/**"
  - "apps/ucmc-web/playwright.config.ts"
  - ".github/workflows/cicd.yml"
---

# Testing: E2E (Playwright)

Unit-test guidance (pools, time, what a test should pin) is in `testing.md`; the post-deploy smoke spec is in `testing-smoke.md`.

## E2E

Playwright drives a freshly-spawned dev server. Four projects: `chromium` (Desktop Chrome) runs everything, `mobile-safari` (iPhone 14 / WebKit) + `mobile-chrome` (Pixel 7) are confined by `testMatch` to the `mobile-*` specs, and `smoke` is confined to `smoke.spec.ts` and runs only after a deploy.

**That confinement is deliberate, and widening it means reckoning with two specs, not just adding a viewport.** `gear-scanner.spec.ts`'s camera cases launch their own Chromium with fake-camera flags and would ignore the project's device entirely (its keyboard-wedge case does not, but the file is matched as a whole); the passkey specs drive a WebAuthn virtual authenticator over CDP, which WebKit has no equivalent for. `chromium` correspondingly carries `testIgnore` for the mobile specs — at 1280px they pass trivially and say nothing.

- `e2e/fixtures/mailpit.ts` polls Mailpit for magic links.
- `e2e/fixtures/hydration.ts` — **`waitForHydration(page)` polls `window.$_TSR.hydrated`; premature interaction is the source of every flake.**
- `e2e/fixtures/db.ts` seeds by writing the Miniflare D1 SQLite file directly through `node:sqlite` (see **Seeding cost** below). **`seedSession(email)` returns a session id that IS the `ucmc_session` cookie value** — the cookie holds the opaque id and nothing derived from it. A spec whose subject isn't sign-in should use it: several seconds faster per test, and no dependence on the Mailpit sidecar. (It used to be the only way a spec could run in CI at all; since the full suite runs there that is no longer the reason, but the speed still is.) A spec testing the sign-in flow itself still goes through the real magic link.
- `e2e/fixtures/fake-camera.ts` writes a single-frame Y4M of a QR for Chromium's `--use-file-for-fake-video-capture`. Hand-rolled (text header + planar YUV) because `qrcode` hands over the module matrix and an ffmpeg dependency for three loops is a poor trade.
- The webServer config sets `E2E_BYPASS_RATE_LIMIT=1` and clears Turnstile keys: the 10/60s budget can't cover a suite from one IP, and Turnstile blocks `networkidle` and steals focus.

**The whole suite runs in CI.** Two parallel jobs in `cicd.yml`, split by browser matrix: `e2e-desktop` runs `--project=chromium` with an `axllent/mailpit` service container, and `e2e-mobile` runs the two mobile projects without one. They are parallel, so the suite costs one job's wall-clock.

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

**`workers: 1` is deliberate, not a leftover.** All workers would share this one SQLite file and collide on `user_emails.email`'s global UNIQUE and on each seed's delete-then-insert. Per-worker databases were investigated in #238 and **declined**: the two E2E jobs run in parallel, so the suite's wall-clock is the slower of them, and after the seeding speed-up they are within ~15 s of each other — the entire remaining prize is about 70 s.

**If that 70 s is ever wanted, shard across runners rather than across workers.** `playwright test --shard=i/n` with a job matrix splits the suite over separate machines, and a separate runner is already a separate checkout, dev server and D1 — so the isolation problem does not need solving at all. It also keeps the select-by-project invariant above intact, since `--shard` divides whatever the projects already match. Per-worker `persistState` (the hook exists on `@cloudflare/vite-plugin`) buys the same number for a fixture rewrite plus N dev servers, which is why it was not taken.

`drizzle/seed.ts` still shells out to wrangler — that is a once-per-invocation script, where the boot does not compound.

### Seeded state

**`ensureApprovedUser` writes a current-cycle waiver attestation by default, and `attested: false` is how you opt out.**

The officer queue (`listMembersNeedingAttestationAction`) is every `status='approved'` user anti-joined against the holders of a live attestation. An approved member seeded without one therefore lands in that queue and stays there. Nothing removed them, so the local database reached **523 users, 487 of them in the queue** — and a queue that long makes `boundingBox()` return null for rows `isVisible()` reports as visible, which has already produced one false positive that looks exactly like a layout bug.

Attesting is also the realistic state: an approved member has handed in a signed waiver. A member approved who then never signed is a specific case, not the default one.

**The cycle and version are imported, never recomputed** — `currentSeason()` from `#/config/club-season` and `WAIVER_VERSION` from `#/config/legal`. The predicate in `currentAttestationFilter` is `(cycle, version, revoked_at IS NULL)`, so a hard-coded value would quietly stop matching after the Aug 1 rollover or a version bump, and the symptom would be the slow return of the pollution this prevents. (CLAUDE.md forbids deriving the club year ad-hoc regardless.) The `#/*` alias resolves inside Playwright; `e2e/fixtures/db.ts` imports `#/lib/temporal-install` itself, since nothing installs `Temporal` in the Playwright process.

**`mobile-waiver-queue.spec.ts` is the only spec that opts out**, because there the queue row _is_ the fixture.

**`e2e/global-setup.ts` sweeps the previous run's users before each invocation.** Seeds key on `${prefix}-${Date.now()}@example.com`, so every run leaves its users behind permanently; attesting stops the _queue_ growing but not the user table, since the pending, unclaimed and profile-less seeds leave rows regardless. Steady state is now ~29 users instead of unbounded growth.

Four things about the sweep are load-bearing:

- **It matches the whole `@example.com` domain, not a prefix list.** The prefixes are not a convention anyone enforces — the accumulated rows carried `mobile-overflow-`, `waiver-shift-`, `waiver-inert-`, `e2e-` and a tail of one-off debugging ones, so a prefix list would have left ~40% behind and would miss whatever the next spec invents. RFC 2606 reserves `example.com`, so no address under it can be a real mailbox. **Seed new specs under that domain or the sweep will not see them.**
- **`SEED_ADMIN_EMAIL` is excluded**, read from `process.env` and then from `.env.local` — Vite loads that file for the dev server but nothing loads it for the Playwright process, and the case that matters is a developer who pointed it at an `@example.com` address.
- **It deletes `gear_loans` rows first.** `gear_loans.member_user_id` is the one FK to `users` that is `ON DELETE RESTRICT` rather than cascade, because production must not lose the record of who holds a piece of gear. It blocks the delete outright; the first version of this sweep failed on it.
- **It deletes in chunks of 50.** The dev server is already serving by the time global setup runs, and a single 500-user cascading delete holds SQLite's write lock long enough to starve workerd — which has no busy timeout of its own and fails the request outright. Observed once as `database is locked: SQLITE_BUSY` in the worker log, taking an unrelated spec down with it.

**Sweeping happens on the way in, not on the way out**, so a failed run's rows survive for inspection.

**Known gaps, both deliberate.** Gear rows (`gear_types` / `gear_models` / `gear_items`) accumulate the same way at roughly three per run and are not swept — the ordered delete across five tables with `RESTRICT` FKs between them is a second deletion surface, and at ~60 rows it is not yet causing what the user table caused. And six approved users predating all of this carry **no `user_emails` row at all** (profiles "Dana Officer", "Riley Chen", "Sam Okafor", created 2026-09-20), so an email-keyed sweep cannot see them; they sit in the queue permanently. They were left alone because they are not attributable to any fixture.

**`mobile-overflow.spec.ts` asserts one thing across every public and signed-in route: nothing makes the document wider than the viewport.** That is a whole bug class which is invisible at desktop width and unmistakable on a phone — one element reaches past the page gutter, nothing clips it, the document grows, and the _entire page_ scrolls sideways, header included, and stays that way across client-side navigations. It is easy to reintroduce because each cause (`-mx-*` that doesn't match `PageContainer`'s `px-4 sm:px-6`, a fixed `w-[Npx]`, `whitespace-nowrap` on something long) is reasonable in isolation.

The spec asserts on the **document**, not on components, which is the point: a unit test can pin the class list of the bar that caused it last time, but only a real layout tells us about the next one. Two supporting details are load-bearing. It reports the _outermost_ elements whose right edge is past the viewport, because the bare assertion otherwise leaves you bisecting a route's component tree by hand. And it first asserts `#main` is taller than 120px — **a page that rendered nothing cannot overflow, so a 404 (a page flag off, a session that didn't take) would pass while checking nothing.** Verified against the bug it was written for: restoring `AccountTabsBar`'s flat `-mx-6` fails `/my/profile` with `<div class="-mx-6 mb-6 border-b border-border"> right=398` in a 390px viewport.

**Its officer session is a worker-scoped fixture, not a `beforeEach` seed — and the reason has changed.** It was hoisted for cost: every `ensureApprovedUser` / `seedSession` call shelled out to `wrangler d1 execute`, a full CLI boot at **1.5–2.5 s locally** and slower on a runner, so seeding per test paid that twice for each of the 21 signed-in routes in each of two engines — **84 wrangler boots per CI job** against the 88 page loads they existed to enable. Hoisting took one engine from **66 s to 25.8 s** and both from ~150 s to 72 s.

**Both of its original justifications are now gone.** The boot cost went when seeding moved to `node:sqlite`; the queue pollution went when `ensureApprovedUser` started attesting by default (see **Seeded state** below). What remains is ordinary thrift — 84 seeds a run instead of 2 — plus the `workers: > 1` correctness noted in the next paragraph. That is a weaker case than it once had, and it is written down this way deliberately: if you are reading this because you want to un-hoist it, the honest answer is that nothing breaks if you do, and nothing much is gained either.

**Sharing one session is sound _for this spec_ and not in general.** Nearly every test here is a `goto` plus a measurement, so there is no state for one route to leak into the next. A spec that mutates must keep seeding per test — which is exactly what the one exception does: the `/members/$publicId` case seeds its **own** member and writes hostile profile text onto it (a long unbreakable name, an over-long status line), because that page is built around free text a member types and an empty profile would pass the overflow check while testing nothing. It never touches the shared officer session, and its fixture is a `@example.com` address with `ON DELETE CASCADE` children, so `sweepSeededUsers` reclaims it. The fixture is worker-scoped rather than a `beforeAll` so it stays correct if the suite ever runs `workers: > 1`. It needs `// eslint-disable-next-line no-empty-pattern` on `async ({}, use)`: Playwright reads the first parameter's destructured property names to resolve fixture dependencies, so the pattern has to be there even when there are none.

**`mobile-waiver-queue.spec.ts` measures layout shift, and measures it rather than asserting on markup on purpose.** Ticking a checkbox on `/members/waivers` must not move the rows: the gesture the page exists for is working down a stack of signed papers ticking rows in sequence, and the bulk-attest bar used to mount on first selection. Verified against that regression in both engines — 158px of displacement on an iPhone 14, 142px on the wider Pixel 7, because the bar stacks to a column below `sm`. Any future control that appears above the list reintroduces this whatever it is made of, which a class-list assertion would miss. The companion test pins that the bar is present-and-disabled, since "nothing moved" is also satisfied by never showing it.

Two things about _how_ it measures were each a false positive first, and both are worth knowing before writing another layout-shift test here:

- **It measures the list container, not a row.** "Did selecting a member move the list" is precisely "did anything above the list change height", and the container answers that with no dependence on which rows exist. A row-based measurement was hostage to local D1 state: `ensureApprovedUser` used to leave an approved member with no current-cycle attestation, so **every run that seeded a user added a permanent row to this queue** — the local database reached 487 of them, at which point `boundingBox()` starts returning null for a row that `isVisible()` reports as visible. That is fixed at the source now (**Seeded state** below), but keep the container-based measurement: it was the right call independently of why the rows were there, and this spec is the one that still puts rows in the queue on purpose.
- **It polls until the measurement settles** (`settledListTop`). Chromium's mobile emulation defers layout on a long list: the element is present, `toBeVisible()` passes, and `getBoundingClientRect()` reports all zeros for a beat. Reading "before" inside that window reported the whole settle as a shift — a 470px false positive on Pixel 7 that WebKit never showed. The polling is in the _setup_; the comparison stays exact to a pixel.

**`gear-scanner.spec.ts` covers both of the desk's scan paths, and neither is reachable from the jsdom suite.**

Its two camera cases are **the only tests that exercise a real decode.** The component tests stub `BarcodeScanner` wholesale and `gear-loans.spec.ts` drives the desk through the code-search combobox, so the camera → `BarcodeDetector` → ZXing WASM path had no coverage at all — which is how a stale `zxing_reader.wasm` shipped and silently decoded nothing for months. Linux Chromium has no native `BarcodeDetector`, so CI exercises the ponyfill path, the one that broke. **Both cases fail against a stale binary** — verified, and that is the point of them. `launchOptions` can't live in a `describe`, so those two launch Chromium themselves rather than splitting one file per camera frame.

Its **keyboard-wedge case** (#215) is in the same file for a different reason: it is the only place `cmdk` and Radix are actually in the tree. The wedge listener registers on `document` in the **capture phase** so it beats their Enter and Tab handling, and the component tests stub the combobox out — so bubble-phase passes all 16 of them and fails this. Verified by mutation. It needs no camera, so unlike the two above it takes the project's own `page` fixture rather than launching a browser.
