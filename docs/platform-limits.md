# Platform limits

The Cloudflare, Resend and GitHub limits this repo can actually hit, each from the vendor's docs with the source linked. **Read on 2026-10-27.** Numbers change: re-check the source before relying on one, and update this page (and its date) when you do.

Both stacks run on **Workers Free**, so the Free column is the one that applies. Paid is listed where it is the obvious way out. **UNVERIFIED** means the docs don't say.

`src/server/cost/service-catalog.ts` holds the daily and monthly allowances the analytics platform page measures against. It and this page must agree; when one changes, change the other.

## How this repo handles the limits that bite

| Limit                                                          | Handling                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1: 100 bound parameters per statement                         | No statement's parameter count grows with the data: `inSubquery`, `inJsonArray`, `insertStatements`, and ESLint bans `inArray` ([ADR 0006](./adr/0006-d1-statements-bind-a-fixed-number.md)). A test pins the ceiling against real D1.                                                                                                                                                                                                                      |
| D1: 50 queries per invocation                                  | No chunked reads; batches kept short (largest: 36 statements). Whether each statement in a `batch()` counts is UNVERIFIED.                                                                                                                                                                                                                                                                                                                                  |
| D1: no pragmas in a migration, so no safe parent-table rebuild | Constraints on referenced tables are trigger pairs; migrations only add ([ADR 0007](./adr/0007-every-migration-through-generate.md)).                                                                                                                                                                                                                                                                                                                       |
| D1: 50-byte LIKE pattern                                       | Search uses FTS5 and `likeContains` (`.claude/rules/data/search.md`).                                                                                                                                                                                                                                                                                                                                                                                       |
| D1: 100,000 rows written per day                               | Passkey begin writes nothing (the ceremony is a signed cookie), so reloading `/sign-in` can't spend the quota. Sessions slide at most hourly. The daily tick sweeps consumed passkey ceremonies, email sends and other retention-bound rows (`src/server/cron/retention.server.ts`). **Gap:** expired `sessions` are deleted only when their cookie comes back, and expired `magic_links` not at all, so both grow toward the 500 MB database limit (#373). |
| KV: 1,000 writes per day                                       | The tightest measured constraint (peak 116/day). KV holds only the anonymous-permissions cache, gear carts and cart tokens; never put a per-request write there.                                                                                                                                                                                                                                                                                            |
| Workers: 10 ms CPU per request                                 | Not guarded by tests (local runtimes don't enforce it). `workers.cpu_time_us` is snapshotted daily; #272 saw `exceededResources` on a few percent of prod requests.                                                                                                                                                                                                                                                                                         |
| Workers: 50 subrequests per invocation                         | GitHub issue sync is one GraphQL request with aliased lookups, not one REST call per issue.                                                                                                                                                                                                                                                                                                                                                                 |
| Workers: 5 Cron Triggers per account                           | `wrangler.jsonc` declares two expressions (`0 12 * * *`, the daily tick, and `15 8 1 3 *`) on each of two Workers, so four of the five are used. New work rides the daily tick rather than adding one. Gear reminders accept a one-hour DST drift for the same reason (`.claude/rules/gear/reminders.md`).                                                                                                                                                  |
| D1 Time Travel: 7 days                                         | The deploy records a bookmark before every migration; that is the only way back for data, since rollback is code-only ([ADR 0002](./adr/0002-one-pipeline-from-check-to-prod.md)).                                                                                                                                                                                                                                                                          |
| Rate Limiting: approximate, per location                       | Wrappers fail open; abuse controls are a speed bump, not a guarantee. Five bindings with separate budgets, distinct `namespace_id`s per binding and per stack.                                                                                                                                                                                                                                                                                              |
| Images: 5,000 unique transformations a month                   | Past it, new transformations fail with `9422` and nothing is charged.                                                                                                                                                                                                                                                                                                                                                                                       |
| Resend: 100 emails a day                                       | Prod sends through Resend; dev sends to the outbox ([ADR 0001](./adr/0001-dev-email-outbox.md)). A season-start rush of magic links is the case to watch.                                                                                                                                                                                                                                                                                                   |
| Workers Logs: 200,000 events a day                             | `head_sampling_rate: 1` on both stacks. Over-quota behaviour on Free is UNVERIFIED, and pricing changes on 2026-12-01.                                                                                                                                                                                                                                                                                                                                      |

## Workers

Source: <https://developers.cloudflare.com/workers/platform/limits/> (page updated 2026-10-12)

| Limit                            | Free                                      | Paid                      |
| -------------------------------- | ----------------------------------------- | ------------------------- |
| Requests                         | **100,000/day**                           | no limit                  |
| CPU per HTTP request             | **10 ms**                                 | 30 s default, up to 5 min |
| CPU per Cron Trigger             | 10 ms                                     | 30 s (< 1 h interval)     |
| Startup (global scope)           | 1 s                                       | 1 s                       |
| Memory                           | 128 MB per isolate                        | 128 MB                    |
| Subrequests per invocation       | **50**                                    | 10,000                    |
| Subrequests to internal services | 1,000                                     | matches configured limit  |
| Worker size                      | 64 MiB uncompressed (no compressed limit) | 64 MiB                    |
| Env vars + secrets per Worker    | 64                                        | 128                       |
| Cron Triggers                    | **5 per account**                         | 250                       |
| Static asset files per version   | 20,000                                    | 100,000                   |
| Static asset file size           | 25 MiB                                    | 25 MiB                    |
| Log data per request             | 256 KB                                    | 256 KB                    |
| `waitUntil()`                    | 30 s after the response is sent           | same                      |

### Workers Logs

Source: <https://developers.cloudflare.com/workers/observability/logs/workers-logs/>

| Limit          | Free                                                                                 | Paid                             |
| -------------- | ------------------------------------------------------------------------------------ | -------------------------------- |
| Log events     | **200,000/day**; over-quota behaviour UNVERIFIED                                     | 20M/month included, then $0.60/M |
| Retention      | 3 days                                                                               | 7 days                           |
| Max log size   | 256 KB                                                                               | 256 KB                           |
| Pricing change | "Beginning December 1, 2026, Workers Logs will use Cloudflare Observability pricing" |                                  |

## D1

Sources: <https://developers.cloudflare.com/d1/platform/limits/> (page updated 2026-10-24), <https://developers.cloudflare.com/d1/platform/pricing/>

| Limit                         | Free                                                                     | Paid     |
| ----------------------------- | ------------------------------------------------------------------------ | -------- |
| Rows read                     | **5M/day**, counted as rows scanned                                      | billed   |
| Rows written                  | **100,000/day**; a write touching an indexed column adds a row per index | billed   |
| Over a daily limit            | Queries fail until 00:00 UTC                                             | —        |
| Databases per account         | 10                                                                       | 50,000   |
| Max database size             | **500 MB**                                                               | 10 GB    |
| Storage per account           | 5 GB                                                                     | 1 TB     |
| Queries per Worker invocation | **50**                                                                   | 1,000    |
| Bound parameters per query    | **100**                                                                  | 100      |
| SQL statement length          | 100 KB                                                                   | 100 KB   |
| String / BLOB / row size      | 2 MB                                                                     | 2 MB     |
| Query duration                | 30 s                                                                     | 30 s     |
| Columns per table             | 100                                                                      | 100      |
| LIKE / GLOB pattern           | **50 bytes**                                                             | 50 bytes |
| Arguments per SQL function    | 32                                                                       | 32       |
| Time Travel                   | **7 days**                                                               | 30 days  |

## KV

Sources: <https://developers.cloudflare.com/kv/platform/limits/>, <https://developers.cloudflare.com/kv/platform/pricing/>

| Limit                     | Free                                                            | Paid      |
| ------------------------- | --------------------------------------------------------------- | --------- |
| Reads                     | 100,000/day                                                     | unlimited |
| Writes / deletes / lists  | **1,000/day each**; "further operations of that type will fail" | unlimited |
| Writes to the same key    | 1 per second                                                    | 1/s       |
| Operations per invocation | 1,000                                                           | 1,000     |
| Key / metadata / value    | 512 B / 1,024 B / 25 MiB                                        | same      |
| Storage                   | 1 GB                                                            | unlimited |
| Minimum `cacheTtl`        | 30 s                                                            | 30 s      |

All daily KV and D1 limits reset at 00:00 UTC.

## R2, Images, Rate Limiting

| Service       | Limit                                                                                                                                                                                                                                                                            | Source                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| R2            | Free tier: 10 GB-month storage, 1M Class A and 10M Class B operations a month, free egress. Beyond it, billed.                                                                                                                                                                   | <https://developers.cloudflare.com/r2/pricing/>                               |
| Images        | 5,000 unique transformations a month on Free. Past it, cached ones keep serving, new ones return `9422`, nothing is charged. Whether binding calls draw from the same allowance is implied, not stated.                                                                          | <https://developers.cloudflare.com/images/pricing/>                           |
| Rate Limiting | `period` is 10 or 60 s only. "Approximate", "eventually consistent", and applied separately in each Cloudflare location. `namespace_id` is unique within the **account**; bindings sharing one share counters, across Workers too. The docs advise against IP addresses as keys. | <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/> |

## Resend

Source: <https://resend.com/pricing>

| Limit     | Free                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Volume    | **100 emails a day**, 3,000 a month                                                                                                                               |
| Domains   | The pricing page now lists **3**. ADR 0001 and `infra.md` were written when it was 1, which is why the sending domain lives in the shared `spencerwill.com` repo. |
| Retention | 30 days                                                                                                                                                           |

## GitHub

The repository is **public**. Source: <https://docs.github.com/en/billing/concepts/product-billing/github-actions>

| Limit                           | Value                                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Actions minutes                 | Free for public repositories on standard GitHub-hosted runners. (A private repo on GitHub Free gets 2,000 a month.)                       |
| Rulesets, environment reviewers | Available because the repo is public; the `prod` reviewer gate depends on it ([ADR 0002](./adr/0002-one-pipeline-from-check-to-prod.md)). |

## What local tests don't catch

`vite dev`, `vite preview` and vitest-pool-workers run on Miniflare, which doesn't enforce the 10 ms CPU limit, the 50-subrequest or 50-query caps, or any daily quota (not documented either way, so assume not). The 100-parameter limit **is** enforced locally, which is why `d1-bound-params.test.ts` can pin it.
