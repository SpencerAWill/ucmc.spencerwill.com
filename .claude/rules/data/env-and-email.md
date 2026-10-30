---
paths:
  - "apps/ucmc-web/src/config/env.ts"
  - "apps/ucmc-web/src/server/cloudflare-env.ts"
  - "apps/ucmc-web/src/server/env.server.ts"
  - "apps/ucmc-web/src/server/email/**"
  - "apps/ucmc-web/wrangler.jsonc"
  - "apps/ucmc-web/.env.example"
---

# Env vars and the email tier

Part of the data rule; `data/core.md` covers the bindings.

Why the env is validated up front and fails closed: `docs/adr/0011-validate-the-worker-env-fail-closed.md`.

`@t3-oss/env-core` + zod (`src/config/env.ts`) for `VITE_*` client vars. **Every server var and secret is read as `serverEnv().NAME`** (`src/server/env.server.ts`); `cloudflare-env.ts`'s `WorkerEnv` types bindings only.

- **Two layers**: the Zod schema checks each variable alone (blank means unset); `configurationProblems()` checks combinations. `server-entry.ts` runs both before every request (ahead of the edge cache) and every cron tick, so a bad config is a 500 everywhere and an `env.invalid` log line naming variables, never values.
- **A deployed-only rule keys on `APP_BASE_URL` being https.** Required there: `SESSION_SECRET`, both Turnstile keys, an email provider. Refused there: `MAILPIT_URL`, `E2E_BYPASS_RATE_LIMIT`. A bare local checkout must still boot.
- **`EMAIL_OUTBOX` with `RESEND_API_KEY` is not a problem** — dev holds a stale key and the outbox winning is ADR 0001's safeguard. Don't port flareling's rule refusing the pair.
- **`LOG_LEVEL` is the one var read raw** (by the logger, which must work while validation fails) and is not in the schema: a typo means `info`, never an outage.
- **Never call `serverEnv()` at module scope**, same as the bindings.
- **Tests that vary a var mock `#/server/env.server`** and spread overrides over `actual.serverEnv()` (see `health.test.ts`). It caches per isolate, so writing onto `env` from `cloudflare-env` no longer reaches readers.
- **Adding a var**: a schema entry, a line in `.env.example`, and either `scripts/wrangler-env.ts` (a var) or `.github/actions/deploy` (a secret). A cross-field rule gets a case in `src/server/__tests__/env.test.ts`.

Local dev loads from `apps/ucmc-web/.env.local` per wrangler v4 `.env` precedence (`.dev.vars` is no longer used). The devcontainer sets `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` so host shell env wins over `.env.local`. Deployed envs get vars from Pulumi outputs, written into `wrangler.jsonc` by `sync-env`, and secrets via `wrangler deploy --secrets-file` in `.github/actions/deploy`.

Email picks a tier through `emailTier()` (`src/server/email/email-tier.ts`): the D1 outbox if `EMAIL_OUTBOX` (dev only, behind Cloudflare Access), else the Resend API if `RESEND_API_KEY`, else Mailpit at `MAILPIT_URL`, **else it throws `EmailNotConfiguredError`**. The console-log "fallback" this used to describe was removed deliberately — it either dumped magic-link URLs into dashboard-readable Workers Logs or left users staring at a never-arriving email. See `notifications.md`.

**`email_outbox` is the one table holding correspondence** — recipient, subject and body, which for a magic link is a working credential. It is written on dev only, pruned on read and swept daily at one day. Turning it on for prod is a compliance change, not a config flag.
