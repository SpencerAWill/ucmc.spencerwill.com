---
paths:
  - "infra/**"
  - ".github/workflows/**"
---

# Infrastructure (`infra/`) and CI

**Pulumi**, two stacks (`dev` auto, `prod` manual + approval), state in Pulumi Cloud, `pnpm` runtime. Auth via `CLOUDFLARE_API_TOKEN`.

The **Cloudflare provider** manages Worker custom domains, D1 databases, R2 buckets (private + public, with `R2CustomDomain` `minTls: "1.2"`), KV namespaces, and Resend DNS records (SPF, DKIM, MX). The `spencerwill.com` zone itself is NOT Pulumi-managed. D1/R2/KV are `protect: true`.

**Stack outputs consumed by `deploy.yml`:** `d1DatabaseId`, `kvNamespaceId`, `r2PublicHost` (→ `VITE_R2_PUBLIC_HOST`), `resendApiKey`, `resendFromEmail`. Bucket names are exported for drift detection only — wrangler binds buckets by name.

## Resend (`infra/resend.ts`)

A custom `ResendDomain` component shells out to `infra/scripts/resend.mjs` via `@pulumi/command` — **no dynamic provider, because pnpm and Pulumi dynamic providers don't mix** (pulumi/pulumi#9085).

## `@pulumi/cloudflare` and `@pulumi/pulumi` are pinned EXACTLY, on purpose

`infra/package.json` carries `6.17.0` and `3.257.0` with no caret. package.json
cannot hold a comment, so the reason lives here: **provider 6.21.0 plans a
REPLACEMENT of the dev D1 database** — `+-1 to replace`, with an empty property
diff, which is the signature of a resource whose schema changed under a stable
program rather than of anything the program asked for.

Replacing a D1 database wipes every row. The `protect: true` on that resource is
what caught it (`error: unable to replace resource … as it is currently marked
for protection`), and it caught it in `pulumi preview` on a PR, which is the
only reason it was not discovered by `deploy.yml` auto-deploying dev on the next
push to main.

So a `@pulumi/cloudflare` bump is **not** a routine dependency update here:

- Raise it in its own PR, never inside a Dependabot group bump.
- Read the `pulumi preview` diff before merging. A `replace` or `delete` line
  against D1, R2 or KV means stop — those are the `protect: true` resources, and
  protection turns the data loss into a failed deploy, not a safe one.
- Dependabot will keep proposing the bump. Closing it is a valid answer until
  somebody has time to work out which property the provider now treats as
  replace-triggering and pin or `ignoreChanges` it.

Prereq: `RESEND_MANAGEMENT_API_KEY` (full-access) as a GitHub env secret on both environments, and exported locally for `pulumi up`.

**Single-domain sharing** (free-tier limit): prod owns the `ResendDomain`; dev sets `resendOwnerStack: prod` and reads `resendApiKey` + `resendFromEmail` via `pulumi.StackReference`. **Prod must `pulumi up` before dev** so the StackReference resolves. The component is `protect: true` — destroying it re-issues DKIM and invalidates the sending token.

## Workflows

- `ci.yml` — per-PR, and the only gate. A paths-filter gates web lint/typecheck/knip/vitest, two parallel E2E jobs (`e2e-desktop` with a Mailpit service container, `e2e-mobile` for WebKit + Pixel), `workflow-lint`, and infra lint/typecheck + `pulumi preview`; the workspace audit always runs. A workflow-level `concurrency` group cancels superseded runs.
- `deploy.yml` — push-to-main auto-deploys dev with infra-dev → web-dev chaining; prod via `workflow_dispatch` with environment approval. It rewrites `wrangler.jsonc`'s placeholder `database_id` / KV id from Pulumi outputs, and supplies vars via `--var` flags plus `wrangler secret put`. **Each deploy ends in a post-deploy smoke test** against the deployed URL (`--project=smoke`); a failure turns the deploy job red.
- `quality.yml` — weekly (`schedule:`) + `workflow_dispatch`. **Reports, not gates**: coverage today, and the home for anything else too slow to justify per-PR. Putting an advisory check in `ci.yml` is how it becomes a merge blocker nobody chose.
- `seed-admin.yml` — manual sysadmin promotion. Remote sysadmin seeding is this Action, **not** a script.
- `lint-pr.yaml` — PR title lint. Uses `pull_request_target` because reading a PR title needs a token a fork's `pull_request` run doesn't get; it never checks out the PR and holds `pull-requests: read` only. zizmor flags the trigger, and `.github/zizmor.yml` explains why it's ignored here.

## Workflow hygiene

**Every third-party action is pinned to a 40-character commit SHA with a `# vX.Y.Z` comment.** A tag is mutable — `@v7` is whatever the owner last pointed it at — so a tag pin trusts the action's owner continuously rather than once. Dependabot's `github-actions` ecosystem updates SHA pins and their comments natively, so this costs nothing to maintain. **Don't reintroduce a tag ref; `zizmor` will flag it.**

`workflow-lint` runs **actionlint** (schema, `${{ }}` expression types, and shellcheck over every `run:` body) and **zizmor** (security shapes: template injection, credential persistence, dangerous triggers, cache poisoning). Both install from pinned release tarballs verified against a SHA-256 in the job's `env:` — **bump the version and the checksum together**, or the job fails on the integrity check.

Three rules the fixes follow, and each bites again the moment someone writes a new step:

- **Never interpolate `${{ }}` into a `run:` body.** The expansion is substituted into the shell source _before_ the shell parses it, so the value becomes code, not data. Pass it through `env:` and reference `$VAR`.
- **Don't `curl` a deployed URL from a runner — it gets 403'd at the edge.** Cloudflare scores a bare `curl` from a datacenter ASN as a bot and blocks it before the Worker is reached; GitHub runners sit on Microsoft ranges. `deploy.yml` had a "Wait for the deployment to answer" step and it **never passed once** — 403 on all 30 attempts of every run, instantly rather than after a wait, while the same URL served 200 to any browser and to `curl` from a residential IP. It read as a broken deploy and was neither a timing nor a Worker problem. **Browser headers do not fix this**: it was tried, and the response was `HTTP/2 403` + `cf-mitigated: challenge` — a managed challenge, which requires executing JavaScript and which `curl` therefore cannot pass whatever headers it sends. Post-deploy verification is the Playwright smoke test alone, which drives real Chromium and so lands on the right side of the score. If you ever need a cheap precursor, it has to be something that can clear a challenge, not `curl` with dressing. A `403` carrying `cf-mitigated` is a Cloudflare block, not an app failure, and its `cf-ray` is the key Security Events is searchable by.
- **`actions/checkout` sets `persist-credentials: false`** everywhere. Nothing here pushes, and the default leaves a usable token in `.git/config` for every later step.

**`deploy.yml` runs `d1 migrations apply` _before_ `wrangler deploy`.** That ordering opens a window where the previous Worker runs against the new schema — see the `rename-permission-or-setting` skill for what that means for renames.
