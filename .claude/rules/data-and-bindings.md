---
paths:
  - "apps/ucmc-web/src/server/**"
  - "apps/ucmc-web/drizzle/**"
  - "apps/ucmc-web/wrangler.jsonc"
  - "apps/ucmc-web/src/config/env.ts"
---

# Cloudflare bindings, D1, and env

## Function-wrapped access invariant

**Never read `env.DB` / `env.KV` / `env.BUCKET_*` at module scope.** Always go through `getDb()` / `getKv()` / `getPrivateBucket()` / `getPublicBucket()`. The `cloudflare:workers` module is stubbed for non-SSR bundles by a vite plugin, so module-scope access breaks the client build.

## The bindings

- **D1** (Drizzle ORM) — schema `drizzle/schema.ts`, generated migrations committed in `drizzle/migrations/`. `wrangler.jsonc`'s `database_id` is a placeholder; `deploy.yml` rewrites it from the Pulumi `d1DatabaseId` output.
- **KV** — same UUID-injection pattern (`kvNamespaceId` Pulumi output).
- **R2** — name-based bindings (no UUID injection). Two buckets per env: `BUCKET_PRIVATE` (worker-mediated reads, the default for new media) and `BUCKET_PUBLIC` (bound to `cdn.{dev.,}ucmc.spencerwill.com` via `R2CustomDomain`, reads bypass the worker). **Use `getPrivateBucket()` for any new media unless the URL shape is unguessable AND the content is intended public.** Avatars and landing images use content-hashed keys + opaque public IDs in the public bucket. **Public uploads MUST set `httpMetadata.cacheControl` at upload time** — custom domains pass through stored metadata, not worker headers.
- **Rate limiting** — two `unsafe.bindings`: `HEALTH_RATE_LIMITER` (20/60s per IP) and `AUTH_RATE_LIMITER` (10/60s per key, with `ip:` and `email:` keys for independent budgets). Wrappers in `src/server/rate-limit.server.ts` fail _open_. `E2E_BYPASS_RATE_LIMIT=1` short-circuits for Playwright.

## SQLite pragmas do not work in a migration, so a parent table cannot be rebuilt

**`PRAGMA foreign_keys`, `defer_foreign_keys` and `legacy_alter_table` are accepted by D1 and silently ignored inside a migration.** SQLite makes them no-ops within a transaction, and every migration file is applied as one implicitly transactional batch — `applyD1Migrations` does `db.batch(queries)`, and `wrangler d1 migrations apply` does the same. Accepted is not honoured, and nothing reports the difference.

This matters because SQLite has no `ALTER COLUMN`: tightening a constraint means the create-copy-drop-rename rebuild, which is **only** safe with foreign keys off. **`0026_unclaimed_status.sql` and `0030_gear_description_required.sql` both open with `PRAGMA foreign_keys=OFF` and both worked — but neither proves the pragma did anything.** The tables they rebuilt (`user_emails`, `gear`) have no children, so there was nothing to cascade either way. Copying that pattern onto a referenced table is the trap.

Measured on `users`, the parent of **40 foreign key edges across 28 tables**: the rebuild completes, raises no error and leaves a valid schema, while

- **7 `ON DELETE CASCADE`** edges delete their rows (`sessions`, `profiles`, `user_roles`, `user_emails`, …),
- **32 `ON DELETE SET NULL`** edges blank their columns — including both actor columns on `audit_log`, so rows survive looking fine with their attribution gone,
- **1 `ON DELETE RESTRICT`** edge (`gear_loans`) aborts the migration outright once a single loan row exists, and migrations run _before_ `wrangler deploy`.

`defer_foreign_keys` defers violation _checking_ to commit; it does not suppress cascade _actions_. Renaming the parent out of the way first does not help either: with foreign keys live, `ALTER TABLE … RENAME` rewrites every `REFERENCES` clause to follow the rename, so the children track the old table wherever it goes and whatever gets dropped is always the thing they point at.

**So: to constrain a column on a referenced table, use a `BEFORE INSERT` / `BEFORE UPDATE OF` trigger pair that `RAISE(ABORT, …)`s.** It is enforced by the database, so it covers writers that bypass Drizzle (`drizzle/seed.ts`, the raw SQL in `seed-admin.yml`), and the abort message can match what the real constraint would have said. `0071_users_public_id_not_null.sql` is the worked example, and the cost is that `PRAGMA table_info` still reports the column nullable — so `schema-drift.test.ts` keeps a permanent `KNOWN_NULLABILITY_DRIFT` entry for it.

## R2 key prefixes

A prefix is agreed by three places — the minting helper, the URL-stripping helper, and the `routes/api/*.$.ts` route that re-prepends it to read from R2 — plus `GC_PREFIXES` in `server/cron/retention.server.ts`. **Keys are never user-visible, so a prefix outliving its feature's rename is correct**: `album/` is still `gallery/` and sponsor logos are `sponsors/`. Re-keying would mean a copy-then-delete pass over every deployed bucket where a partial run strands objects. A round-trip test pins each pair, because the Album's drifted during a rename and 404'd every photo in local dev. **"Fixing" a stale-looking prefix in `GC_PREFIXES` silently stops the orphan sweep from ever seeing those objects.**

## Free-text search goes through `likeContains(column, query)`

In `src/server/db/index.ts`, beside `isUniqueViolation` / `isForeignKeyViolation`. It builds the `%needle%` pattern, escapes `%` / `_` / `\` in the user's input, **and emits the `ESCAPE` clause** — the last part is load-bearing and is why this is one helper rather than a bare needle-builder. SQLite only honours an escape character when the pattern carries an explicit `ESCAPE`, and Drizzle's `like()` never emits one, so escaping without it is _worse_ than not escaping: `50%` becomes `%50\%%`, which matches a literal backslash and therefore nothing.

## D1 binds at most 100 parameters per statement — `selectInChunks` for anything unbounded

`D1_MAX_BOUND_PARAMS = 100` in `src/server/db/index.ts`, pinned against real D1 by `src/server/db/__tests__/d1-bound-params.test.ts` (100 binds, 101 raises `too many SQL variables`). This is D1's limit, not Drizzle's: Drizzle emits a correct statement and the driver refuses to bind it.

So **`inArray(col, ids)` is only safe when `ids` comes from a UI page already bounded well under 100.** When the list is "everything matching X", wrap the read in `selectInChunks(ids, (chunk) => …)`, which splits it into statements D1 accepts and concatenates the rows. `listExceptionsFor` (`src/server/events/events-repo.server.ts`) is the reference call site; the waiver bulk-attest and role-member-diff validation reads are the other two.

Two things that are easy to get wrong:

- **A cap on the caller is not a fix.** `BULK_ATTEST_MAX` and `ROLE_MEMBERS_DIFF_MAX` sat at 200 — exactly double what D1 takes — and the calendar's exception lookup has no cap to raise or lower at all, because its list is every series in the window. Chunk the query; let the caps express what one operator action should cost.
- **`ORDER BY` does not span chunks.** A single sort cannot cross separate statements, so either sort the merged rows yourself or depend only on ordering within one key — which holds whenever every row for an id lands in the same chunk, as it does when chunking by that id. Pass `reservedParams` for anything else the statement binds (a date range, a status), so adding a filter to a chunked query cannot quietly push it back over the limit.

Found the hard way: see #259. The symptom is a 500 on a page that worked yesterday, once a table crossed ~100 rows in the queried window.

## Env

`@t3-oss/env-core` + zod (`src/config/env.ts`) for `VITE_*` client vars. Server vars (`APP_BASE_URL`, `WEBAUTHN_RP_*`, `RESEND_*`, `SESSION_SECRET`, `MAILPIT_URL`) reach handlers via the Worker `env` binding through `src/server/cloudflare-env.ts`.

Local dev loads from `apps/ucmc-web/.env.local` per wrangler v4 `.env` precedence (`.dev.vars` is no longer used). The devcontainer sets `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` so host shell env wins over `.env.local`. Deployed envs get vars from Pulumi `--var` flags + `wrangler secret put` via `deploy.yml`.

Email has **two** tiers (`src/server/email/resend.ts`): Resend API if `RESEND_API_KEY`, else Mailpit at `MAILPIT_URL`, **else it throws `EmailNotConfiguredError`**. The console-log "fallback" this used to describe was removed deliberately — it either dumped magic-link URLs into dashboard-readable Workers Logs or left users staring at a never-arriving email. See `notifications.md`.

## Cost and usage snapshots

`cost_snapshots` records what the site costs and how much free tier is left, written by a third task on the daily cron (`src/server/cron/cost-snapshot.server.ts`). Reports and the future analytics panel read it; nothing reads a vendor API at request time.

**Rows are daily, not monthly**, because every source reports daily and the limits that bind (Workers requests, D1 rows, KV operations) are themselves daily. Monthly totals derive from daily; the reverse does not.

**Three sources, and the split is not cosmetic:**

| Source                 | Covers          | Why separate                                                                                                           |
| ---------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `cloudflare_billing`   | R2 only         | The Billable Usage API reports **only services with a paid subscription**. On a free plan that is R2 and nothing else. |
| `cloudflare_analytics` | Workers, D1, KV | GraphQL datasets — the only place free-tier usage exists at all.                                                       |
| `resend`               | email sends     | Resend publishes **no** usage history, so the figures are rolled up from our own `email_sends` log.                    |

**`quantity` is `ConsumedQuantity`, never `PricingQuantity`.** The latter is what remains _after_ the free allowance and is `0` on every row while inside the free tier — recording it snapshots zeros forever. Likewise `ConsumedUnit` is empty on count-based services and `PricingUnit` carries the real unit.

**`CLOUDFLARE_ACCOUNT_READ_TOKEN` needs five scopes**, and `Account Analytics: Read` is **not** sufficient for the three product datasets despite the docs — Workers Scripts Read, D1 Read and Workers KV Storage Read are each required for their own. It reads telemetry for the whole account, so it stays on the cron path; **adding a scope is a permission grant, not a config tweak.**

**Two API constraints, both established by probing:** the range caps at **90 days** (92 is rejected), and retention is shallower than the subscription — undocumented, ~108 days when measured. Backfill therefore stops when a window returns nothing rather than walking toward a known start date, recording a floor in KV because an absence leaves no row to re-read.

**Never write a zero row for a source that failed.** A zero later reads as a true measurement of nothing and is indistinguishable from a real reading; a gap is honest. The same rule is why the Resend rollup emits nothing for days before `email_sends` existed, and why analytics rows leave `cost_cents` null rather than 0.

**`cost_snapshots` is never swept** — operational spend, not member data, and reports want it forever. `email_sends` _is_ swept at 90 days, and that sweep is housekeeping rather than a privacy promise: the table carries **no recipient**, deliberately, and adding one is a compliance change (privacy notice, data export, delete cascade, compliance matrix) rather than a schema tweak.

Free-tier limits live in `src/server/cost/service-catalog.ts`. They are the one part of this feature no API can verify — Cloudflare reports consumption and says nothing about entitlement — so each carries a `limitSource` and will go stale. As measured, **KV writes are the tightest constraint** (1,000/day) by roughly a factor of two over everything else.
