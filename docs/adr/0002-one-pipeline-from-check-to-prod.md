# 0002. One pipeline from check to prod

- **Status:** Accepted
- **Date:** 2026-10-19
- **Issue:** #312

## Context

CI and deploys were two workflows. `ci.yml` checked PRs. `deploy.yml` ran on every push to `main` without waiting for those checks, deployed dev, and deployed prod on a `workflow_dispatch` of **any ref**, so nothing tied what reached prod to a commit that had passed CI or dev's smoke test.

`deploy.yml` was four near-copies (`infra-dev`, `web-dev`, `infra-prod`, `web-prod`), about 200 duplicated lines, and the copies had already drifted once with real cost: prod lacked wrangler-action's `environment: production`, and every prod deploy uploaded prod's secrets into the dev Worker. Resource ids reached `wrangler.jsonc` by `sed` over placeholder UUIDs, a silent no-op if a placeholder was ever renamed. Secrets went up by `wrangler secret put`, one call and one Worker version per secret, before the deploy, so a failure halfway left old code with some new secrets. Migrations ran with no recorded way back, and a failed prod smoke test only turned the job red, leaving prod on the bad version.

flareling, a template derived from this repo, had since solved the same problems ([its ADR 0021](https://github.com/SpencerAWill/flareling/blob/main/docs/adr/0021-one-pipeline-from-check-to-prod.md)). Its comparison of the shapes GitHub offers holds here too: a separate deploy workflow on `push` either re-runs every check or deploys without them; `workflow_run` runs the default branch's copy of the workflow, with secrets the triggering run never had, across two run pages; deploy jobs inside the CI workflow, `needs:` the checks, deploy exactly what passed.

## Decision

- **One workflow, `cicd.yml` ("CI/CD")**, on every PR, every push to `main`, and `workflow_dispatch` as a break-glass re-run of `main`. PRs run the checks, path-filtered. **A push runs every check unfiltered**: what deploys is the merged tree, which no PR run tested exactly. `required` aggregates the checks and is still the only status check the ruleset names; outside a PR it also fails on a skipped check, since there a skip means something broke.
- **`Deploy — dev` then `Deploy — prod`, in the same run.** Dev deploys after `required`; prod after dev deployed and passed its smoke test, waiting for the `prod` environment's reviewer (infra/github). No repo variable guards that the reviewer exists: infra/github refuses an empty reviewer list, and the repo must be public for reviewers to exist at all.
- **One composite action, `.github/actions/deploy`**, with the stack as the only input that differs. A composite action rather than a reusable workflow, because flareling found environment secrets never reach a reusable workflow; each job names its environment and passes the secrets in. Order: `pulumi up`, `sync-env`, build, D1 restore point, migrate, deploy, smoke test, and on prod a rollback if the smoke test failed.
- **Wrangler environments stay**: top level is dev, `env.production` is prod. They're Cloudflare's documented model for persistent environments, and the Vite plugin selects one at build time with `CLOUDFLARE_ENV`, writing the target into `dist/server/wrangler.json`. Every later `wrangler` command reads that file and refuses a different `--env`/`CLOUDFLARE_ENV`, so one variable set at the top of the job selects prod everywhere. flareling dropped Wrangler environments for one config rewritten wholesale per stack; here that would mean every per-stack value (Worker name, bucket names, rate-limit namespaces) becoming a stack output or a table, for no gain over the checks below.
- **`sync-env` (`apps/ucmc-web/scripts/sync-env.ts`) replaces the `sed`.** It reads `pulumi stack output --json` once and, through `jsonc-parser` (comments survive), writes the D1 and KV ids and the Worker vars into the stack's section. It checks rather than rewrites what the program and file must already agree on: the Worker name (the field the secrets-to-dev bug got wrong), the D1 database name and the R2 bucket names. It fails on a binding or key it hasn't been taught, on a binding `env.production` doesn't repeat (bindings don't inherit, and wrangler only warns), and on an output Pulumi printed as `[secret]`. Its test runs against the committed `wrangler.jsonc`.
- **Vars move from `--var` flags into the config** that `sync-env` writes, and **secrets ship with the version** via `wrangler deploy --secrets-file`. The file is additive: a secret left out keeps its deployed value, so unset optional ones are omitted rather than blanked.
- **A D1 restore point before every migration**: `wrangler d1 time-travel info` records the current bookmark, and the job summary carries the exact restore command.
- **Rollback is prod-only and code-only.** A failed prod smoke test runs `wrangler rollback`, returning the Worker to its previous version, with that version's vars and secrets. A failed dev smoke test leaves dev on the failing version, to inspect, and prod never starts.

## Consequences

- One run page shows a commit's checks, its dev deploy, and its prod approval and deploy. A job waiting for approval uses no runner time; approvals expire after 30 days.
- **Every merge asks for a prod approval.** Approve the newest; it contains the others. Each environment has a concurrency group with `cancel-in-progress: false`, so a deploy is never cut off. GitHub keeps one pending run per group and a newer one replaces it. Whether a prod job waiting for its reviewer counts as pending, and is replaced by the next merge's, is **unverified** until real runs show it.
- **Migrations must only add** (expand now, contract in a later release). Three things now depend on it: the old Worker briefly runs on the new schema during each deploy, prod migrates hours or days after dev, and rollback restores code but not D1. The way back for data is the bookmark, and Workers Free keeps 7 days of Time Travel.
- **Dev deploys on every push**, docs-only included: `deploy.yml`'s infra/web path skipping is gone, deliberately. Dev also deploys later than before, after the full e2e suite.
- **A new binding is a two-file change**: `wrangler.jsonc` and `scripts/wrangler-env.ts`. CI says so before a deploy does.
- **A new stack bootstraps by hand.** `pulumi up` precedes the Worker deploy, and the custom domain needs the Worker to exist (README, "Bootstrapping").
- `./.github/actions/deploy` is referenced by path, not GitHub's newer `$/` self-repository form, until actionlint can parse it (rhysd/actionlint#760). `.github/zizmor.yml` records the ignore.
- Kept from before, unlike flareling: the per-PR WebKit/mobile e2e job and the `vite preview` smoke run of the production build.
