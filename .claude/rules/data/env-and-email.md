---
paths:
  - "apps/ucmc-web/src/config/env.ts"
  - "apps/ucmc-web/src/server/cloudflare-env.ts"
  - "apps/ucmc-web/src/server/email/**"
  - "apps/ucmc-web/wrangler.jsonc"
  - "apps/ucmc-web/.env.example"
---

# Env vars and the email tier

Part of the data rule; `data/core.md` covers the bindings.

`@t3-oss/env-core` + zod (`src/config/env.ts`) for `VITE_*` client vars. Server vars (`APP_BASE_URL`, `WEBAUTHN_RP_*`, `RESEND_*`, `SESSION_SECRET`, `MAILPIT_URL`) reach handlers via the Worker `env` binding through `src/server/cloudflare-env.ts`.

Local dev loads from `apps/ucmc-web/.env.local` per wrangler v4 `.env` precedence (`.dev.vars` is no longer used). The devcontainer sets `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` so host shell env wins over `.env.local`. Deployed envs get vars from Pulumi outputs, written into `wrangler.jsonc` by `sync-env`, and secrets via `wrangler deploy --secrets-file` in `.github/actions/deploy`.

Email picks a tier through `emailTier()` (`src/server/email/email-tier.ts`): the D1 outbox if `EMAIL_OUTBOX` (dev only, behind Cloudflare Access), else the Resend API if `RESEND_API_KEY`, else Mailpit at `MAILPIT_URL`, **else it throws `EmailNotConfiguredError`**. The console-log "fallback" this used to describe was removed deliberately — it either dumped magic-link URLs into dashboard-readable Workers Logs or left users staring at a never-arriving email. See `notifications.md`.

**`email_outbox` is the one table holding correspondence** — recipient, subject and body, which for a magic link is a working credential. It is written on dev only, pruned on read and swept daily at one day. Turning it on for prod is a compliance change, not a config flag.
