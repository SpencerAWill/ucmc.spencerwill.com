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

## R2 key prefixes

A prefix is agreed by three places — the minting helper, the URL-stripping helper, and the `routes/api/*.$.ts` route that re-prepends it to read from R2 — plus `GC_PREFIXES` in `server/cron/retention.server.ts`. **Keys are never user-visible, so a prefix outliving its feature's rename is correct**: `album/` is still `gallery/` and sponsor logos are `sponsors/`. Re-keying would mean a copy-then-delete pass over every deployed bucket where a partial run strands objects. A round-trip test pins each pair, because the Album's drifted during a rename and 404'd every photo in local dev. **"Fixing" a stale-looking prefix in `GC_PREFIXES` silently stops the orphan sweep from ever seeing those objects.**

## Free-text search goes through `likeContains(column, query)`

In `src/server/db/index.ts`, beside `isUniqueViolation` / `isForeignKeyViolation`. It builds the `%needle%` pattern, escapes `%` / `_` / `\` in the user's input, **and emits the `ESCAPE` clause** — the last part is load-bearing and is why this is one helper rather than a bare needle-builder. SQLite only honours an escape character when the pattern carries an explicit `ESCAPE`, and Drizzle's `like()` never emits one, so escaping without it is _worse_ than not escaping: `50%` becomes `%50\%%`, which matches a literal backslash and therefore nothing.

## Env

`@t3-oss/env-core` + zod (`src/config/env.ts`) for `VITE_*` client vars. Server vars (`APP_BASE_URL`, `WEBAUTHN_RP_*`, `RESEND_*`, `SESSION_SECRET`, `MAILPIT_URL`) reach handlers via the Worker `env` binding through `src/server/cloudflare-env.ts`.

Local dev loads from `apps/ucmc-web/.env.local` per wrangler v4 `.env` precedence (`.dev.vars` is no longer used). The devcontainer sets `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` so host shell env wins over `.env.local`. Deployed envs get vars from Pulumi `--var` flags + `wrangler secret put` via `deploy.yml`.

Email uses a three-tier fallback (`src/server/email/resend.ts`): Resend API if `RESEND_API_KEY`, else Mailpit at `MAILPIT_URL`, else a Worker console log.
