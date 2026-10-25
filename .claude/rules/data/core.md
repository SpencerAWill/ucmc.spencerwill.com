---
paths:
  - "apps/ucmc-web/src/server/**"
  - "apps/ucmc-web/drizzle/**"
  - "apps/ucmc-web/wrangler.jsonc"
  - "apps/ucmc-web/src/config/env.ts"
---

# Cloudflare bindings, D1, and env

The binding-access rule, the bindings and the D1 parameter limit: true of every
server statement. The rest of this rule is split by area under
`.claude/rules/data/` and loads with the files it is about: `migrations.md`
(`generate`, drift, and why a parent table can't be rebuilt), `search.md`
(FTS5 and `likeContains`), `r2.md` (key prefixes), `env-and-email.md` and
`cost-snapshots.md`. Read the relevant one before changing behaviour it covers.

## Function-wrapped access invariant

**Never read `env.DB` / `env.KV` / `env.BUCKET_*` at module scope.** Always go through `getDb()` / `getKv()` / `getPrivateBucket()` / `getPublicBucket()`. The `cloudflare:workers` module is stubbed for non-SSR bundles by a vite plugin, so module-scope access breaks the client build.

## The bindings

- **D1** (Drizzle ORM) — schema `drizzle/schema.ts`, generated migrations committed in `drizzle/migrations/`. `wrangler.jsonc`'s `database_id` is a placeholder; the deploy's `sync-env` (`scripts/wrangler-env.ts`) writes it from the Pulumi `d1DatabaseId` output. **A new binding must be taught to `wrangler-env.ts`** and repeated in `env.production`, or `sync-env` refuses the file.
- **KV** — same UUID-injection pattern (`kvNamespaceId` Pulumi output).
- **R2** — name-based bindings (no UUID injection). Two buckets per env: `BUCKET_PRIVATE` (worker-mediated reads, the default for new media) and `BUCKET_PUBLIC` (bound to `cdn.{dev.,}ucmc.spencerwill.com` via `R2CustomDomain`, reads bypass the worker). **Use `getPrivateBucket()` for any new media unless the URL shape is unguessable AND the content is intended public.** Avatars and landing images use content-hashed keys + opaque public IDs in the public bucket. **Public uploads MUST set `httpMetadata.cacheControl` at upload time** — custom domains pass through stored metadata, not worker headers.
- **Rate limiting** — five `unsafe.bindings`, each its own budget. Wrappers in `src/server/rate-limit.server.ts` fail _open_. `E2E_BYPASS_RATE_LIMIT=1` short-circuits for Playwright.

  | Binding                 | Budget                 | Covers                                                                                                |
  | ----------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
  | `HEALTH_RATE_LIMITER`   | 20/60s per IP          | `/health`                                                                                             |
  | `AUTH_RATE_LIMITER`     | 10/60s per key         | magic-link request + consume, passkey **finish** (`ip:` / `email:` keys); feedback under its own keys |
  | `CEREMONY_RATE_LIMITER` | 60/60s per IP          | passkey **begin**, register and authenticate (#306)                                                   |
  | `UPLOAD_RATE_LIMITER`   | 5/60s per user         | avatar uploads                                                                                        |
  | `CALENDAR_RATE_LIMITER` | 60/60s per token or IP | `.ics` feeds                                                                                          |

  **Passkey begin is off `AUTH_RATE_LIMITER` on purpose.** Autofill starts an authenticate ceremony on every `/sign-in` load, before the visitor does anything, and a campus NAT puts many visitors on one IP — on the shared budget, loading the page could exhaust the magic-link request, whose deliberate "check your email" reply then hides that no email was sent. Begin writes nothing (the ceremony travels in a signed cookie); finish, which verifies a credential and writes the single-use marker, stays on the strict budget.

## No statement may bind a data-dependent number of parameters (#291)

`D1_MAX_BOUND_PARAMS = 100` in `src/server/db/index.ts`, pinned against real D1 by `src/server/db/__tests__/d1-bound-params.test.ts` (100 binds, 101 raises `too many SQL variables`). This is D1's limit — the [limits page](https://developers.cloudflare.com/d1/platform/limits/) — not Drizzle's: Drizzle emits a correct statement and the driver refuses to bind it.

Two ordinary shapes grow with the data, and both reach 100 through normal use:

- **`inArray(col, list)`** binds one parameter per element.
- **`insert().values(rows)`** binds one parameter per column **per row**. Far tighter than it looks: an audit row binds 7, so 15 audit events in one statement fail — which is how every bulk action that touched 15+ targets broke at once, and an 8-piece desk checkout with it.

So the rule is about the statement's shape, not about call sites that happen to have broken. Three tools, in order of preference:

1. **A subquery or join, when the list came out of the database.** `WHERE model_id IN (SELECT id FROM gear_models WHERE type_id = ?)` — one parameter, the planner does the matching, and there is no list to outgrow anything. Fetching ids in JavaScript only to hand them back is the round trip to remove. Write it with **`inSubquery` / `notInSubquery`**, typed to take a query builder and reject an array.
2. **`inJsonArray(col, values)` / `notInJsonArray`, when the list came from the caller.** One JSON parameter expanded by `json_each`, at any length (verified with 5000). This is the pattern D1's own docs give: [Expand arrays for IN queries](https://developers.cloudflare.com/d1/reference/query-json). An empty list matches nothing.
3. **`insertStatements(table, rows, { onConflictDoNothing | onConflictDoUpdate })` / `insertMany`, for multi-row writes.** Splits the rows into statements of `rowsPerInsertStatement(table, rows)` and runs them in one batch. D1 applies its per-query limits to **each statement in a batch** and runs the batch as a transaction, so the write stays atomic and costs one round trip. An upsert's `set` must read `excluded.*` — a bound JS value there would add parameters the sizing doesn't count. Use `runBatch` for any statement list that may be empty: Drizzle's batch is typed as a non-empty tuple.
4. **A cross product is built in SQL, not in JavaScript.** Bulk tagging's 500 items × 50 tags is 25,000 rows; split to fit, that was a thousand statements in one batch. `bulkAddGearItemTags` is one `INSERT … SELECT … FROM json_each(?) CROSS JOIN json_each(?) WHERE true ON CONFLICT DO NOTHING` — four parameters at any size. (`WHERE true` resolves SQLite's parse ambiguity between `ON CONFLICT` and a join constraint.)

**`rowsPerInsertStatement` must be handed the rows.** A column with a SQL-expression default (`created_at` = `unixepoch() * 1000`) is inlined only when the row _omits_ it; supplied, it binds. Counting it as inlined is how the bulk tagger — which supplies `assigned_at` — still overflowed after the first pass of #291. Everything else is counted even when omitted (Drizzle actually writes a literal `null`), so the figure can only overcount: an extra statement costs nothing, a miscount costs a 500.

**ESLint bans `inArray` / `notInArray`** — from `drizzle-orm` and every sub-path that re-exports them (`no-restricted-imports`), and in the relational-query callback whether destructured or reached as `ops.inArray` (`no-restricted-syntax`), which no import ban can see. The only exemption is `d1-bound-params.test.ts`, which has to build the forbidden statement to pin the ceiling. Inserts aren't lint-guarded — a multi-row `.values(rows)` is legitimate for a fixed small set — so a new bulk write goes through `insertStatements` by convention and gets a test past its old limit.

**Fixed constant lists go through `json_each` too** (`status IN ('approved','unclaimed')`, the calendar's visibility scope). A table-valued function over two or three values costs nothing measurable, and a second sanctioned form for "lists that can't grow" would bring back the judgement call the ban exists to remove.

**Chunked reads are gone.** #261's `selectInChunks` split one query into several, and **Workers Free allows 50 D1 queries per invocation**; `json_each` and a subquery stay at one, and keep a single `ORDER BY`. Whether each statement _inside_ a batch counts toward that 50 is not documented — the limits page ties the figure to subrequests, and Drizzle's `batch` is one call to D1, so most likely not, but Miniflare doesn't enforce it and it is unverified. Keep batches short regardless: the largest today is a 500-row bulk audit at 36 statements. Caps on callers are not a fix either — they couple a product decision to a storage limit, and #291's audit found twenty caps that still let a statement past 100. The caps that remain (`BULK_ATTEST_MAX`, `ROLE_MEMBERS_DIFF_MAX`, the 500-row gear selections) are product bounds; no statement's size depends on them.

Found the hard way twice: #259 (a 500 once a table crossed ~100 rows in the window) and #291 (an audit of every query: 37 unbounded, 20 capped above the limit).
