# 0011. Validate the Worker env up front and fail every request when it is wrong

- **Status:** Accepted
- **Date:** 2026-10-30
- **Issue:** #319

## Context

Vars and secrets reach the Worker on the `cloudflare:workers` `env` object, which `src/server/cloudflare-env.ts` cast to a hand-written interface with no runtime check. Each reader re-checked what it cared about at first use: `signing.server.ts` threw on a short `SESSION_SECRET`, `email-tier.ts` refused the outbox without its Access settings, `resend.ts` refused a missing sender. A misconfigured deploy therefore failed on whichever path touched the bad variable first — often a sign-in, often long after the post-deploy smoke test had passed against `/health`.

Some mistakes are invisible to any one reader: a Turnstile secret without its site key refuses every sign-in silently; `E2E_BYPASS_RATE_LIMIT` or `MAILPIT_URL` on a deployed Worker is wrong only because of where it is.

flareling validates its env with t3 + Zod on the first request and adds cross-field `configurationProblems()`. Alternatives considered: keep per-reader checks (the status quo), or validate but only log.

## Decision

- **Every var and secret is read through `serverEnv()`** (`src/server/env.server.ts`): one Zod schema for each variable alone, then `configurationProblems()` for combinations. Bindings stay on `cloudflare-env.ts` and the `getDb()` / `getKv()` / bucket getters. `LOG_LEVEL` is the one var outside it, read raw by the logger, which must work while validation is failing; a typo there means `info` rather than an outage. A failure is logged once per isolate.
- **It fails closed.** `server-entry.ts` checks before the cache layer, so every request — cache hits included — is a plain 500 and every cron tick runs nothing. The log line names variables, never values; the response names nothing.
- **"Deployed" means `APP_BASE_URL` is https.** There it requires `SESSION_SECRET`, both Turnstile keys and an email provider, and refuses `MAILPIT_URL` and `E2E_BYPASS_RATE_LIMIT`. Locally a bare checkout still boots.
- **`EMAIL_OUTBOX` beside `RESEND_API_KEY` is allowed**, unlike flareling. Deploys only add secrets, dev still holds a key from before ADR 0001, and the outbox winning over it is that ADR's safeguard; refusing the pair would take dev down for the safeguard working.
- Plain Zod rather than t3: there are no client vars on this side, and blanks-as-unset is one `preprocess`.

## Consequences

- A bad deploy fails its smoke test, and prod's code rolls back. A wrong secret now costs the whole site rather than one path — that is the trade, and why the cross-field rules are kept to combinations that cannot work rather than ones that merely look odd.
- A new variable is a schema entry; a reader that goes around `serverEnv()` loses validation, so `WorkerEnv` no longer types vars at all.
- `serverEnv()` caches per isolate. Tests that vary a var mock `#/server/env.server` and layer their values over the real result; writing onto the binding object no longer reaches readers.
- A rule that only makes sense deployed has to be keyed on the https test, or it breaks local development.
