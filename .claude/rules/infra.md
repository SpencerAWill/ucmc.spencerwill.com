---
paths:
  - "infra/**"
  - ".github/workflows/**"
---

# Infrastructure (`infra/cloudflare`, `infra/github`) and CI

**Pulumi**, two programs, state in Pulumi Cloud, `pnpm` runtime:

- **`infra/cloudflare`** — stacks `dev` (every push to `main`) and `prod` (the same pipeline run, after a reviewer approves). The provider authenticates from the `CLOUDFLARE_API_TOKEN` env var, which CI fills from the least-privilege `CLOUDFLARE_INFRA_API_TOKEN` (deploy) or `CLOUDFLARE_PREVIEW_API_TOKEN` (PR preview).
- **`infra/github`** — stack `main`: this repo's settings, ruleset, environments and CI credentials (#311). See the section below.

The **Cloudflare provider** manages Worker custom domains, D1 databases, R2 buckets (private + public, with `R2CustomDomain` `minTls: "1.2"`), KV namespaces, and on dev the outbox's Access application. The `spencerwill.com` zone itself is NOT Pulumi-managed. D1/R2/KV are `protect: true`.

**Stack outputs consumed by the deploy action** (`.github/actions/deploy`, read once with `pulumi stack output --json`): `sync-env` (`apps/ucmc-web/scripts/wrangler-env.ts`) writes `d1DatabaseId`, `kvNamespaceId` and the Worker vars (`appBaseUrl`, `webauthnRpId`, `webauthnRpName`, `resendFromName`, `cloudflareAccountId`, plus `resendFromEmail` on prod and `emailOutbox` / `accessTeamDomain` / `accessOutboxAud` on dev) into the stack's `wrangler.jsonc` section, and **checks** `workerNameOutput`, `d1DatabaseNameOutput` and the two R2 bucket names against what the file commits. `r2PublicHost` and `turnstileSiteKey` are build-time `VITE_*` values; `turnstileSecretKey` and `resendApiKey` go into the secrets file. **Renaming or removing one of these outputs breaks the next deploy**; `sync-env` names the missing key.

## Resend comes from the shared stack (#298)

**This repo owns no Resend resources.** The verified sending domain, `spencerwill.com`, lives in [SpencerAWill/spencerwill.com](https://github.com/SpencerAWill/spencerwill.com) (stack `SpencerAWill/spencerwill-shared/prod`), which issues one sending-scoped key per app. Resend's free plan allows one verified domain per account, so the domain can only live in one place, and the shared repo is the place that serves several apps from it.

- **Prod** sets `emailStack: SpencerAWill/spencerwill-shared/prod` and reads `ucmcResendApiKey` and `ucmcFromEmail` (`ucmc@spencerwill.com`) through a `pulumi.StackReference`. They are re-exported as `resendApiKey` / `resendFromEmail`, so the deploy didn't change.
- **Dev** has `emailOutbox` and no Resend. The two are exclusive, and a stack with neither is refused at preview: it would have no way to send.
- **Apply the shared stack before this one.** A StackReference to an output that doesn't exist yet fails the `up`. Removing or renaming one of those outputs is the reverse: stop reading it here first.
- The key is scoped to the domain, not the address, so either app's key could send as any `@spencerwill.com` address. That's Resend's limit, not ours.

Until #298, prod owned a `ResendDomain` component for `ucmc.spencerwill.com` (via `@pulumi/command`, because pnpm and Pulumi dynamic providers don't mix: pulumi/pulumi#9085), and dev borrowed its key through `resendOwnerStack: prod`. Both are gone; the component now lives in the shared repo.

## `@pulumi/cloudflare` and `@pulumi/pulumi` are pinned EXACTLY, on purpose

`infra/cloudflare/package.json` carries `6.22.1` and `3.270.0` with no caret. package.json
cannot hold a comment, so the reason lives here: **provider 6.21.0 and 6.22.1 planned a
REPLACEMENT of the D1 database on both stacks** — `+-1 to replace`, with an
empty property diff. The `protect: true` on that resource is what caught it
(`error: unable to replace resource … as it is currently marked for
protection`), in `pulumi preview` on a PR, not in the auto-deploy of dev.

**The cause was `primaryLocationHint`.** `pulumi preview --json` names it in the
step's `replaceReasons` even though old and new both read `"enam"`: the hint is
create-only, Cloudflare never returns it on read, and newer providers mark it
replace-on-change, so the refreshed `null` against the program's `"enam"` is a
"change". `ignoreChanges: ["primaryLocationHint"]` does **not** fix it (the
replace is the provider's own plan, not an input diff); removing the property
from the program does, leaving an in-place update with no input changes.

**That in-place update then failed the dev deploy** (run 40367460851):
6.22.1's D1 update is a full PUT, and with `readReplication` undeclared it
sends `read_replication: null`, which Cloudflare rejects —
`400 … Invalid property: read_replication => Expected object, received null`.
`preview` can't catch this; only `up` makes the call. The program now declares
`readReplication: { mode: "disabled" }`, which is what both databases already
had (`wrangler d1 info <uuid> --json`). With it declared, `preview` plans no
D1 step at all on either stack, so `up` never makes the PUT.

So a `@pulumi/cloudflare` bump is still **not** a routine dependency update here:

- Raise it in its own PR, never inside a Dependabot group bump.
- Read the `pulumi preview` diff before merging, on **both** stacks. A `replace`
  or `delete` line against D1, R2 or KV means stop — those are the
  `protect: true` resources, and protection turns the data loss into a failed
  deploy, not a safe one.
- An empty diff on a replace doesn't hide the cause:
  `pulumi preview --stack <s> --json` lists it under the step's
  `replaceReasons`. A create-only property is the usual suspect; dropping it
  from the program is the fix when the resource already exists.
- `infra/github` also depends on `@pulumi/cloudflare` (still `6.17.0`, for
  token minting); bump it separately with its own preview.

## The dev email outbox (`infra/cloudflare/outbox.ts`)

`emailOutbox: true` creates a self-hosted `ZeroTrustAccessApplication` on `<hostname>/dev/outbox` with an inline allow policy for `outboxViewers`, and exports its `aud` for the Worker to verify tokens against. **`configureOutbox` throws on the `prod` stack** — the outbox holds working sign-in links. See `docs/adr/0001-dev-email-outbox.md`.

- **The Zero Trust organization is not Pulumi-managed.** It is account-wide and shared with flareling; `accessTeamDomain` is config. Its login methods are set by hand in the dashboard. Organizations created since June 2026 default to the Cloudflare identity provider restricted to account members, so a viewer who isn't an account member needs One-time PIN added (Zero Trust → Integrations → Identity providers).
- **The infra token needs account-level `Access: Apps and Policies Write`** (and the preview token its `Read` form) for dev's `up` and preview. Without it the dev preview fails on the Access application.
- **The application covers the custom domain only, so the Workers serve nothing else.** `wrangler.jsonc` sets `workers_dev: false` and `preview_urls: false` (both inherited by `env.production`). `workers_dev` defaults to `true` when there are no `routes`, and ours live in Pulumi, so removing the key quietly reopens a `workers.dev` hostname that bypasses Access, WAF and bot rules. The page's own JWT check is the backstop if it ever is.

## `infra/github`: the repo's settings and CI credentials (#311)

**Applied locally by a repo admin (`pnpm preview` / `pnpm apply` in `infra/github`), never from CI.** The Actions `GITHUB_TOKEN` can't change repo settings or write secrets, and CI must not hold a credential that can loosen its own rules. README → "GitHub as code" has the first-time setup and the rotation command.

- **The ruleset requires one check: `cicd.yml`'s `required` job**, which waits on every other check. Add or rename jobs freely; **a new check job must be added to `required`'s `needs:`**, or it can fail without blocking a merge. `pulumi-preview` is deliberately outside it.
- **Cloudflare tokens are minted, least-privilege, per job type** (`src/cloudflare-tokens.ts`): deploy (wrangler: no zone access at all, since `wrangler.jsonc` has no `routes`), infra (`pulumi up`) and preview (the infra token's reach, read-only, derived). **Add a permission in the same PR as the resource or command that needs it.** `pulumi up` with no diff makes no write calls, so a missing permission surfaces the next time that resource _changes_, not on the next deploy. `R2CustomDomain` is the one resource type not yet proven against the infra token's list (flareling's token runs all the others). **The old hand-made token also had `SSL and Certificates Edit`; it was left out on purpose**, because on the shared zone it reaches every site's certificates. If a custom-domain change 403s on a certificate call, add `SSL and Certificates Write` to the infra token's `zone` list (the preview token gets the read form automatically).
- **Pulumi has no stored token.** Every Pulumi job declares an environment, has `id-token: write`, and logs in with `pulumi/auth-actions`. The OIDC issuer and its trust policies live in **SpencerAWill/spencerwill.com's `infra/github`** (`pulumiOidcRepositories`), not here: Pulumi Cloud allows one GitHub issuer per org. A **new environment that runs Pulumi must be added there first**, and policies match GitHub's _immutable_ subject, which this repo was switched to. The token is personal (every stack, every repo), which is why `preview` needs a reviewer.
- **`dev` has no reviewer, deliberately**, though spencerwill.com's README asks for one on every OIDC environment: every push to `main` deploys dev, so a reviewer means approving every merge twice. What gates it instead is the branch policy (`main` only) plus the ruleset (`main` only changes by a PR that passed CI).
- **Every repository setting is declared, matching what the repo had at adoption.** The provider treats an omitted optional field as "clear it". Change a setting by changing it here; a change made in the GitHub UI is reverted on the next apply.
- **Hand-managed, deliberately**: `SESSION_SECRET`, `CLOUDFLARE_ACCOUNT_READ_TOKEN`, `SITE_FEEDBACK_GITHUB_TOKEN` and the `SITE_FEEDBACK_GITHUB_REPO` variable. Environments are `retainOnDelete` because they hold those secrets.
- **It must stay public**: on GitHub Free, rulesets, environment secrets and required reviewers exist for a personal account's repos only when public.

## Workflows

- `cicd.yml` — **one pipeline from check to prod** (#312, `docs/adr/0002-one-pipeline-from-check-to-prod.md`). Runs on PRs, on push to `main`, and on `workflow_dispatch` (a break-glass re-run of `main`). The checks: a paths-filter gates web lint/typecheck/knip/migration drift/vitest, two parallel E2E jobs, both inside the Playwright image (`e2e-desktop` with a Mailpit service container, `e2e-mobile` for WebKit + Pixel), `workflow-lint`, and infra lint/typecheck (both programs); the `audit` job (`pnpm audit`, `trustPolicy` over the locked tree via `--fix-lockfile`, a check that the two Mailpit pins agree, and one that the Playwright image tag equals the locked `@playwright/test`) and the `secrets` job (gitleaks over the full history, #316) always run. **Off a PR the paths outputs are all `true`**, so a push runs every check, and `required` fails on a skip there too. On PRs only, `pulumi preview` of both `infra/cloudflare` stacks runs in the reviewer-gated `preview` environment (skipped for Dependabot). Concurrency cancels superseded PR runs and never cancels a run on `main`.
- **Deploys** (`cicd.yml`, `main` only): `Deploy — dev` after `required`, then `Deploy — prod` after dev, **in the same run**, waiting for the `prod` environment's reviewer. Each is one job running the composite action **`.github/actions/deploy`**, with the stack as the only input that differs: `pulumi up` → `sync-env` → build → the secrets file (before D1 is touched, so a missing secret fails with the database unchanged) → a **D1 Time Travel restore point** written to the job summary → `d1 migrations apply` → `wrangler deploy --secrets-file` (code, vars and secrets as one Worker version) → the Playwright smoke test (`--project=smoke`) → on **prod only**, `wrangler rollback` if the new version went out and smoke didn't pass (failed, or never ran). **`Deploy — prod` refuses any commit but `main`'s current head** (`git ls-remote`, unauthenticated because the repo is public), so approving an older waiting run can't regress prod. Each environment has a `concurrency` group with `cancel-in-progress: false`. Prod is selected by `CLOUDFLARE_ENV=production`, which the build bakes into `dist/server/wrangler.json` and every later `wrangler` command then checks itself against.
- `quality.yml` — weekly (`schedule:`) + `workflow_dispatch`. **Reports, not gates**: coverage today, and the home for anything else too slow to justify per-PR. Putting an advisory check in `cicd.yml` is how it becomes a merge blocker nobody chose.
- `seed-admin.yml` — manual sysadmin promotion. Remote sysadmin seeding is this Action, **not** a script.
- `lint-pr.yaml` — PR title lint. Uses `pull_request_target` because reading a PR title needs a token a fork's `pull_request` run doesn't get; it never checks out the PR and holds `pull-requests: read` only. zizmor flags the trigger, and `.github/zizmor.yml` explains why it's ignored here.

## Workflow hygiene

**Every third-party action is pinned to a 40-character commit SHA with a `# vX.Y.Z` comment.** A tag is mutable — `@v7` is whatever the owner last pointed it at — so a tag pin trusts the action's owner continuously rather than once. Dependabot's `github-actions` ecosystem updates SHA pins and their comments natively, so this costs nothing to maintain. **Don't reintroduce a tag ref; `zizmor` will flag it.**

`workflow-lint` runs **actionlint** (schema, `${{ }}` expression types, and shellcheck over every `run:` body) and **zizmor** (security shapes: template injection, credential persistence, dangerous triggers, cache poisoning). Both install from pinned release tarballs verified against a SHA-256 in the job's `env:` — **bump the version and the checksum together**, or the job fails on the integrity check.

Three rules the fixes follow, and each bites again the moment someone writes a new step:

- **Never interpolate `${{ }}` into a `run:` body.** The expansion is substituted into the shell source _before_ the shell parses it, so the value becomes code, not data. Pass it through `env:` and reference `$VAR`.
- **Don't `curl` a deployed URL from a runner — it gets 403'd at the edge.** Cloudflare scores a bare `curl` from a datacenter ASN as a bot and blocks it before the Worker is reached; GitHub runners sit on Microsoft ranges. The old `deploy.yml` had a "Wait for the deployment to answer" step and it **never passed once** — 403 on all 30 attempts of every run, instantly rather than after a wait, while the same URL served 200 to any browser and to `curl` from a residential IP. It read as a broken deploy and was neither a timing nor a Worker problem. **Browser headers do not fix this**: it was tried, and the response was `HTTP/2 403` + `cf-mitigated: challenge` — a managed challenge, which requires executing JavaScript and which `curl` therefore cannot pass whatever headers it sends. Post-deploy verification is the Playwright smoke test alone, which drives real Chromium and so lands on the right side of the score. If you ever need a cheap precursor, it has to be something that can clear a challenge, not `curl` with dressing. A `403` carrying `cf-mitigated` is a Cloudflare block, not an app failure, and its `cf-ray` is the key Security Events is searchable by.
- **`actions/checkout` sets `persist-credentials: false`** everywhere. Nothing here pushes, and the default leaves a usable token in `.git/config` for every later step.
- **Every workflow starts from `permissions: {}`, and every job declares its own** (#317). A job added without a `permissions:` block then gets no token scopes rather than the repository default. Give the new job the narrowest block that works; don't widen the workflow default.
- **Container images are pinned by version _and_ index digest** (`image: name:vX.Y.Z@sha256:…`), for the same reason actions are pinned to a SHA: a tag can be re-pointed. Mailpit appears twice, as the `e2e-desktop` service and in `.devcontainer/docker-compose.yml`. Dependabot's `docker-compose` ecosystem bumps the compose file; nothing reads the CI service image, so move it in the same change. **`mcr.microsoft.com/playwright` appears twice too**, as both E2E jobs' `container:`; Dependabot doesn't read job containers either, and it has to follow `@playwright/test` rather than float on its own — see `testing-e2e.md`.

**The deploy runs `d1 migrations apply` _before_ `wrangler deploy`.** That ordering opens a window where the previous Worker runs against the new schema — see the `rename-permission-or-setting` skill for what that means for renames. Two more reasons a migration must only add (expand now, contract in a later release): **prod migrates hours or days after dev**, in the same run, behind its reviewer; and **a failed prod smoke test rolls back the Worker's code, never D1**. The way back for data is the Time Travel bookmark in the run's summary (7 days on Workers Free).

**`wrangler.jsonc` keeps Wrangler environments** (top level = dev, `env.production` = prod): Cloudflare's documented model for persistent environments, selected at build time by the Vite plugin. Bindings are non-inheritable, so every binding is repeated in `env.production`; `sync-env` refuses a file where they differ, a binding it has no output for, and any top-level or section key it hasn't been taught. **Adding a binding means teaching `scripts/wrangler-env.ts` in the same change** — its test runs against the committed file, so CI says so before a deploy does.

**The local deploy action is referenced as `./.github/actions/deploy`**, not GitHub's newer `$/` self-repository form that zizmor suggests: actionlint can't parse `$/` yet (rhysd/actionlint#760). `.github/zizmor.yml` carries the ignore and the reason; switch when actionlint catches up. Dependabot watches `/.github/actions/*` as well as the workflows.
