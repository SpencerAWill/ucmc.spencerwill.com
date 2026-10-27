---
paths:
  - "apps/ucmc-web/src/server/**"
  - "apps/ucmc-web/drizzle/**"
  - "apps/ucmc-web/wrangler.jsonc"
  - "apps/ucmc-web/src/config/env.ts"
---

# Cloudflare bindings, D1, and env

Why no statement binds a data-dependent number of parameters, and why not chunking or caps: `docs/adr/0006-d1-statements-bind-a-fixed-number.md`. Platform numbers (D1, KV, R2, Workers Free): `docs/platform-limits.md`. This file is the rules for server code that touches bindings.

The rest of the data rule is split by area under `.claude/rules/data/` and loads with its files: `migrations.md`, `search.md` (FTS5, `likeContains`), `r2.md` (key prefixes), `env-and-email.md`, `cost-snapshots.md`.

## Where things go

- **D1** (Drizzle): schema `drizzle/schema.ts`, generated migrations in `drizzle/migrations/`. The `wrangler.jsonc` `database_id` is a placeholder; `sync-env` (`scripts/wrangler-env.ts`) writes it from the Pulumi `d1DatabaseId` output.
- **KV**: same injection (`kvNamespaceId`).
- **R2**: name-based bindings. `BUCKET_PRIVATE` (Worker-mediated reads, the default for new media) and `BUCKET_PUBLIC` (served from `cdn.{dev.,}ucmc.spencerwill.com` by `R2CustomDomain`, bypassing the Worker).
- **Rate limiting**: five `unsafe.bindings`, each its own budget, wrapped in `src/server/rate-limit.server.ts` (fail **open**; `E2E_BYPASS_RATE_LIMIT=1` short-circuits for Playwright).

  | Binding                 | Budget                 | Covers                                                                                                |
  | ----------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
  | `HEALTH_RATE_LIMITER`   | 20/60s per IP          | `/health`                                                                                             |
  | `AUTH_RATE_LIMITER`     | 10/60s per key         | magic-link request + consume, passkey **finish** (`ip:` / `email:` keys); feedback under its own keys |
  | `CEREMONY_RATE_LIMITER` | 60/60s per IP          | passkey **begin**, register and authenticate (#306)                                                   |
  | `UPLOAD_RATE_LIMITER`   | 5/60s per user         | avatar uploads                                                                                        |
  | `CALENDAR_RATE_LIMITER` | 60/60s per token or IP | `.ics` feeds                                                                                          |

- **The D1 helpers** live in `src/server/db/index.ts`: `D1_MAX_BOUND_PARAMS = 100`, `inSubquery` / `notInSubquery`, `inJsonArray` / `notInJsonArray`, `insertStatements` / `insertMany`, `rowsPerInsertStatement`, `runBatch`, `isUniqueViolation`. `src/server/db/__tests__/d1-bound-params.test.ts` pins the ceiling against real D1 (100 binds, 101 raises `too many SQL variables`).

## Rules that are easy to break

- **Never read `env.DB` / `env.KV` / `env.BUCKET_*` at module scope.** Go through `getDb()` / `getKv()` / `getPrivateBucket()` / `getPublicBucket()`; `cloudflare:workers` is stubbed for non-SSR bundles, so module-scope access breaks the client build.
- **Use `getPrivateBucket()` for new media** unless the URL is unguessable **and** the content is meant to be public (avatars and landing images: content-hashed keys + opaque public ids).
- **Public uploads set `httpMetadata.cacheControl` at upload time.** The custom domain serves stored metadata, not Worker headers.
- **Passkey begin stays off `AUTH_RATE_LIMITER`.** Autofill begins a ceremony on every `/sign-in` load, and a campus NAT shares one IP; on the shared budget, loading the page could exhaust the magic-link request, whose "check your email" reply would then hide that nothing was sent. Finish stays on the strict budget.
- **No statement's parameter count may grow with the data** (D1 refuses past 100). In order of preference:
  1. **List came out of the database** → a subquery or join, written with `inSubquery` / `notInSubquery`. Don't fetch ids into JavaScript to hand them back.
  2. **List came from the caller** → `inJsonArray` / `notInJsonArray` (one JSON parameter via `json_each`; an empty list matches nothing).
  3. **Multi-row write** → `insertStatements(table, rows, { onConflictDoNothing | onConflictDoUpdate })` / `insertMany`: split to fit, one atomic batch. An upsert's `set` reads `excluded.*`, never a bound JS value. Use `runBatch` when the statement list may be empty.
  4. **Cross product** → built in SQL (`INSERT … SELECT … FROM json_each(?) CROSS JOIN json_each(?) WHERE true ON CONFLICT DO NOTHING`; `WHERE true` resolves SQLite's `ON CONFLICT` parse ambiguity), never as rows in JavaScript.
- **ESLint bans `inArray` / `notInArray`**, imported from any `drizzle-orm` path or reached as `ops.inArray` in a relational-query callback. The only exemption is `d1-bound-params.test.ts`.
- **Fixed constant lists go through `json_each` too** (`status IN ('approved','unclaimed')`, the calendar's visibility scope). One sanctioned form, no judgement call.
- **`rowsPerInsertStatement` must be handed the rows**: a column with a SQL default binds when the row supplies it. The sizing may overcount, never undercount.
- **No chunked reads, and no caps as a fix.** Workers Free allows 50 D1 queries per invocation; keep batches short too (the largest today is a 500-row bulk audit at 36 statements). Remaining caps (`BULK_ATTEST_MAX`, `ROLE_MEMBERS_DIFF_MAX`, the 500-row gear selections) are product bounds.

## Adding things

- **A new binding** is added to `wrangler.jsonc` top level **and** `env.production` (bindings don't inherit), and taught to `scripts/wrangler-env.ts`, or `sync-env` refuses the file.
- **A new rate-limit binding** gets its own `namespace_id`, distinct from every other binding's and between dev and prod: the id is account-wide, and bindings that share one share counters, across Workers too.
- **A new bulk write** goes through `insertStatements` (inserts aren't lint-guarded) and gets a test past its old limit.
