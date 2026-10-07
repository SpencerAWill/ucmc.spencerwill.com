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
- **A step that curls a deployed URL must send browser headers.** Cloudflare scores a bare `curl/8.x` from a datacenter ASN as a bot and 403s it at the edge, before the Worker is reached. GitHub runners sit on Microsoft ranges, so the request is refused instantly and identically on every retry — it looks like a broken deploy, not like a block, and the same URL serves 200 to any browser and to `curl` from a residential IP. `deploy.yml`'s "Wait for the deployment to answer" shipped without them and 403'd 30/30 on every run it ever had. It now sends the same `User-Agent` / `Accept` / `Accept-Language` the Playwright smoke test does, so the cheap precursor and the real check sit on the same side of the bot score, and dumps the final response headers on failure — `cf-mitigated` names a Cloudflare block and `cf-ray` is what Security Events is searchable by.
- **`actions/checkout` sets `persist-credentials: false`** everywhere. Nothing here pushes, and the default leaves a usable token in `.git/config` for every later step.

**`deploy.yml` runs `d1 migrations apply` _before_ `wrangler deploy`.** That ordering opens a window where the previous Worker runs against the new schema — see the `rename-permission-or-setting` skill for what that means for renames.
