# ucmc.spencerwill.com

The University of Cincinnati Mountaineering Club's software system.

## Repository Structure

This is a polyglot pnpm monorepo with the following workspace layout:

- `apps/` — Applications
  - `apps/ucmc-web/` — UCMC web app (TanStack Start on Cloudflare Workers)
- `infra/` — Pulumi infrastructure-as-code
  - `infra/cloudflare/` — Cloudflare resources (stacks `dev`, `prod`)
  - `infra/github/` — this repo's GitHub settings and CI secrets (stack `main`, run locally by an admin)
- `docs/adr/` — architecture decision records, for decisions that span infra, app and workflow at once
- `.devcontainer/` — Dev container configuration (`initialize.sh` on the host, `configure-git.sh` on create; see [`.claude/rules/devcontainer.md`](.claude/rules/devcontainer.md) on git index-lock contention)
- `.zed/`, `.vscode/` — editor settings; both committed, and their scan/watch exclusions are load-bearing for git performance. `.vscode/tasks.json` wraps the pnpm scripts as run configurations and `.vscode/launch.json` holds the debug ones (Chrome against the dev server, Vitest/Playwright/tsx on the current file)

## Development Setup

### Dev Container (Recommended)

The easiest way to get started is with the included [dev container](https://containers.dev/), which works with VS Code, GitHub Codespaces, and any devcontainer-compatible tool.

The container provides:

- Node.js 24 (matches `.nvmrc`)
- pnpm (via corepack)
- Pulumi CLI
- GitHub CLI
- Claude Code CLI, with `typescript-language-server` on `PATH` for the project's `typescript-lsp` plugin (outside the container, see CLAUDE.md for the one-time link)
- VS Code extensions: Prettier, ESLint, EditorConfig

Named Docker volumes persist the pnpm store, Pulumi config, and Claude data across container rebuilds. GitHub CLI auth is bind-mounted from the host's `~/.config/gh`, so a one-time `gh auth login` on the host carries into every container (macOS users: run it with `--insecure-storage` so the token lands in `hosts.yml` rather than Keychain).

To use it, open the repo in VS Code and select **Reopen in Container** when prompted, or run `Dev Containers: Reopen in Container` from the command palette.

#### Ports

Ports are **published** by `.devcontainer/docker-compose.yml`, not forwarded by the editor, so they reach the host whether you are in VS Code, in Zed, or running `devcontainer up` headless. `devcontainer.json` has no `forwardPorts` on purpose — a port that is both published and forwarded makes VS Code find the host port taken and silently remap it to a random one ([vscode-remote-release#3025](https://github.com/microsoft/vscode-remote-release/issues/3025)).

| Port   | What                                     | Started by                            |
| ------ | ---------------------------------------- | ------------------------------------- |
| `3000` | Vite dev server                          | `pnpm --filter ucmc-web dev`          |
| `4173` | `vite preview` — built worker on workerd | `pnpm --filter ucmc-web preview`      |
| `6006` | Storybook                                | `pnpm --filter ucmc-web storybook`    |
| `9323` | Playwright UI mode / HTML report         | `pnpm --filter ucmc-web e2e:ui`       |
| `8025` | Mailpit web UI + REST API                | the `mailpit` sidecar, always running |
| `1025` | Mailpit SMTP intake                      | same (nothing speaks SMTP to it yet)  |

Because these are published rather than forwarded, each server has to bind `0.0.0.0` rather than loopback — all of them already do. There is no X server in the container, so nothing that wants a visible browser window works here; the tools that matter all serve over HTTP instead (Playwright UI mode, `show-report`), and `Simple Browser: Show` will render any of these inside VS Code. Addresses are relative to which side of the container you are on: Mailpit is <http://localhost:8025> from a host browser and `http://mailpit:8025` from inside the container, and both are correct.

### Manual Setup

#### Prerequisites

- [Node.js](https://nodejs.org/) — **v24**, pinned in `.nvmrc`. CI (`actions/setup-node` reads `node-version-file: .nvmrc`) and the devcontainer both run 24, so that is the only version the suite is verified against. `engines`/`devEngines` in the root `package.json` declare `>=24` as a floor and warn rather than fail, so a newer Node still installs — but see `test/setup-dom.ts` for the Node 25 Web Storage shim that newer runtimes need.
- [pnpm](https://pnpm.io/) v11.1.2 (managed by corepack — `package.json#packageManager` pins it, so a `corepack enable` is all you need)
- [Pulumi CLI](https://www.pulumi.com/docs/install/) (for infrastructure changes)

#### Getting Started

```bash
git clone <repo-url>
pnpm install
```

This also sets up Git hooks via Husky.

### pnpm config and supply-chain hardening

All pnpm config (`overrides`, `peerDependencyRules`, `auditConfig`, `minimumReleaseAge`, `trustPolicy`, `allowBuilds`) lives in `pnpm-workspace.yaml`. pnpm 11 stopped reading the `pnpm.*` block in `package.json`, so a stale entry there is a silent no-op.

Three policies are load-bearing for security and should not be relaxed casually:

- **`minimumReleaseAge: 10080`** — pnpm refuses to install any version published in the last 7 days. This catches publish-compromise incidents (a hijacked `latest` tag, a poisoned `postinstall`) before they land in the tree. Because of this, every direct dep is pinned to a specific version that's already older than 7 days. **Never use `"latest"` as a version spec.** If you need to bump a dep, set the exact version in `package.json` and re-run `pnpm install` — pnpm will reject anything fresher than the quarantine window.
- **`trustPolicy: no-downgrade`** — pnpm refuses a version whose publish provenance is weaker than an earlier version of the same package, the signature of a hijacked maintainer token. It runs on every install that resolves (a `package.json` change, `pnpm add`/`update`, Dependabot) and then checks the whole locked tree; CI's `Audit` job enforces it on every PR, since its other installs are `--frozen-lockfile` and check nothing. Exceptions are exact versions in `trustPolicyExclude`, each with its reason; prefer moving the package to a version that has provenance. `.claude/rules/dependencies.md` has the on-demand check.
- **`allowBuilds`** — an explicit allowlist of packages that may run lifecycle scripts (`postinstall`, etc.). Everything else has its build steps blocked. Add to the list only when you've reviewed the script.

### Committing

This repository enforces [Conventional Commits](https://www.conventionalcommits.org/). Commit messages must follow the format:

```
type(scope): description
```

Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

Scopes are validated against workspace package names, plus `devcontainer` for cross-cutting changes.

To use the interactive commit helper:

```bash
pnpm commit
```

### Linting and Formatting

On every commit, the `pre-commit` hook first runs two guards (#316):

- **A mass-deletion guard** refuses a commit that deletes more than 20 files, checked again after lint-staged since that is where the index has been truncated before. That is what a truncated git index looks like (it once produced an 827-file deletion here). Recover with `git reset` (mixed, never `--hard`); for a deletion that really is that large, commit with `ALLOW_MASS_DELETE=1`.
- **gitleaks** scans the staged changes for secrets. The devcontainer image installs it; on a host without it the hook warns and continues (`brew install gitleaks` on a Mac), and the `Secrets — gitleaks` CI job scans the full history on every PR regardless.

Then the following runs via lint-staged:

- **ESLint** — lints and fixes `*.js`, `*.ts`, `*.tsx` files
- **Prettier** — formats all supported file types

The `pre-commit` hook then runs **TypeScript** (`tsc --noEmit`) for each
package whose TypeScript changed — `apps/ucmc-web` (~8s) or `infra` (~1s) —
so a commit can't introduce a type error that only CI would catch. A commit
touching neither package's TypeScript skips it entirely. Deletions, renames
and `tsconfig.json` edits all count as changes, since removing a module
breaks whatever imported it.

To run manually, from the repo root:

```bash
pnpm verify        # lint + typecheck + knip + migration drift + test, every package (~70s)

# or individually
pnpm lint
pnpm typecheck
pnpm knip
pnpm db:drift      # schema.ts vs the newest migration snapshot
pnpm test
pnpm format        # prettier --write . (pnpm format:check to check only)
```

Each of those except `format` is `pnpm -r`, which runs the package's own
script **with the cwd set to that package**. That is not cosmetic: the web
ESLint config resolves its `import/no-restricted-paths` zones against
`process.cwd()`, so a root-level `eslint .` matches none of them and the rule
**fails open** — passing silently rather than erroring. `pnpm -r` is what
makes the root shortcut agree with CI, which invokes the package scripts
directly. Prettier is the exception because its config and `.prettierignore`
are repo-wide, so it genuinely does run once from the root.

[Knip](https://knip.dev) reports unused files, exports, exported types and
dependencies — the module-graph half of dead-code detection that ESLint's
unused-locals rule structurally cannot see. It runs in CI alongside
lint/typecheck/test. Its config, `apps/ucmc-web/knip.config.ts`, carries the
rationale for every entry point and every suppression; read it before adding
either, because most of this app's real entry points (file-based routes, the
Worker entry, stories, both vitest pools) are reached by convention rather
than by an import.

### Web App

The web app lives in `apps/ucmc-web/` and is built with [TanStack Start](https://tanstack.com/start) (React 19, Vite, Tailwind v4, shadcn). It is deployed to Cloudflare Workers via Wrangler, with two environments: **dev** at `dev.ucmc.spencerwill.com` (worker `ucmc-web-dev`) and **prod** at `ucmc.spencerwill.com` (worker `ucmc-web`). Custom domains are provisioned by Pulumi (see Infrastructure below); every merge to main deploys dev, then prod in the same pipeline run once a reviewer approves (see **Pipeline** below).

Dates and times use the TC39 [Temporal](https://tc39.es/proposal-temporal/docs/) API (via `temporal-polyfill`, since workerd and Safari < 17 lack it natively) rather than `Date`. Calendar-shaped rules (waiver cycle, gear due dates) reason in the club's `America/New_York` zone; see [`.claude/rules/dates-and-formats.md`](.claude/rules/dates-and-formats.md) for the invariants.

Phone numbers are stored in E.164 (`+15135551234`) and validated with [`react-phone-number-input`](https://gitlab.com/catamphetamine/react-phone-number-input) (a `libphonenumber-js` wrapper) on the way in; every rendered number goes through `#/lib/phone-format`, which shows US numbers in national form (`(513) 555-1234`), keeps the country code on everything else, and pairs with the `<PhoneLink>` component for click-to-call.

Every public page (`/`, `/gear-cave`, `/policies`, `/scholarships`, `/resources`, `/volunteer`, `/sponsors`, `/history`, `/album`, `/gazette`, `/calendar`) renders a configurable **hero** — editable title and description over an optional auto-advancing image gallery, with hover-revealed arrows and a clock-face autoplay dial that doubles as the pause control. Adding a hero to a new page is one entry in the `HERO_PAGES` registry; see [`.claude/rules/feature-public-pages.md`](.claude/rules/feature-public-pages.md).

Public pages include a **volunteer** page (`/volunteer`) — standing service programs, upcoming outings, and a date-derived archive of everything the club has logged — and a **sponsors** page (`/sponsors`) listing the businesses that back UCMC, each with its logo, what it does for the club, and an officer-editable pitch for prospective sponsors. Sponsor logos are scaled to fit rather than cropped, so a wordmark and a roundel each keep their own shape. Member-only sponsor perks (discounts, codes, how to claim) sit behind their own `public_sponsors:perks` permission and are **stripped from the payload server-side** for anyone who lacks it, so they never reach a signed-out visitor's page source.

Member-facing features include: registration + waiver workflow, feedback, paper-waiver attestation, member directory + management, and a **gear inventory** (`/gear`) with type/tag partitioning (tags can be public or officer-only-`internal`), freeform short codes that print to laminated tags and recycle on retirement, CSV bulk import, per-piece append-only inspection log (pass/fail/advisory), and officer-only barcode label printing (CODE128 via `jsbarcode`). A **gear-loans / checkout** flow on top of the inventory lets a gear-cave keeper (`gear:loan` permission) check pieces out to members at a desk via USB keyboard-wedge scanner, camera barcode scan, or code search, with per-loan due dates and an asymmetric check-in batch that can span multiple borrowers. Members see their own loans at `/my/gear`. **Trip sign-ups** (`/trips`) are a temporary surface that embeds the club's existing Google Form, so members have an in-app place to sign up while the full trips feature is built; see [`.claude/rules/feature-public-pages.md`](.claude/rules/feature-public-pages.md) for what comes out when it lands. Officers can **backfill** historical loans in bulk from a CSV (file, clipboard, or manual entry) — keyed on member primary email + gear `code`, supporting both open and already-returned rows in the same import. A daily job emails borrowers as a loan comes due and as it goes overdue, escalating through the same flag and block thresholds the gear desk enforces, so nobody first learns they're blocked at the counter; it ships behind the `gear.remindersEnabled` switch. Members choose what the club emails them about on `/my/preferences` — though notices about overdue club gear they're holding are not opt-out-able. See [`.claude/rules/notifications.md`](.claude/rules/notifications.md). A **club calendar** (`/calendar`) shows meetings, trips and club events as a month grid with an agenda beside it, with officers creating and editing events — including repeating ones — inline on the same page. The same events are published as subscribable **iCal feeds**: an anonymous one carrying public events, and a per-member one behind a revocable token that a member adds to Apple Calendar, Google Calendar or Outlook once from `/my/calendar` and then never thinks about again. Events carry a three-tier visibility (`public` / `members` / `officers`) that is enforced in SQL on both surfaces, and the feeds resolve what a subscriber may see on every fetch, so a role change takes effect on their next poll. `/calendar` itself is public: an anonymous visitor sees the events officers marked public and can subscribe to a **public feed** carrying exactly those, with no account and nothing to revoke. Events default to members-only, so opening the page does not open its contents. Each member has a **profile** (`/members/$publicId`) built around the person rather than the record: a contour banner drawn from their public id, season rings that close one per club year served, prompt answers and self-rated disciplines they fill in on `/my/profile`, and a badge catalog computed from waiver cycles, gear loans and sweeps — never stored, so an award and its evidence cannot disagree. Waiver standing, emergency contacts and the admin actions sit behind a permission-gated Officer tab. See [`.claude/rules/feature-member-profile.md`](.claude/rules/feature-member-profile.md). See [`.claude/rules/feature-calendar.md`](.claude/rules/feature-calendar.md).

Officers get an **analytics** area (`/analytics`) behind an `analytics:view` permission: a root dashboard that leads with an exception list — what needs attention this week, sorted by consequence rather than by count — over five drill-downs for membership, gear, activity, compliance and platform. Charts run on the **club season** axis (Aug 1 → Jul 31, month 0 = August) rather than a calendar year, so two seasons overlay on one axis and a partial current season compares honestly against the same point in prior ones. Each drill-down additionally requires the permission for the data it shows, so opening the area does not hand over every panel in it; a page the viewer may not read returns `notFound` rather than redirecting, exactly as a switched-off page does. The platform page reads the daily cost/usage snapshots rather than calling vendor APIs from a route loader, and leads with free-tier headroom because the club is inside every free tier and "which service runs out first" is the question that currently has an answer. Charts are rendered with [`@tanstack/charts`](https://tanstack.com/charts), which server-renders the complete SVG so nothing pops at hydration. See [`.claude/rules/feature-analytics.md`](.claude/rules/feature-analytics.md).

Common commands (run from the repo root):

```bash
pnpm --filter ucmc-web dev          # start the dev server on http://localhost:3000
pnpm --filter ucmc-web build        # production build
pnpm --filter ucmc-web test         # run Vitest unit tests (both pools)
pnpm --filter ucmc-web test:coverage     # same, with an Istanbul coverage report
pnpm --filter ucmc-web test:mutation     # Stryker mutation testing (pure modules only)
pnpm --filter ucmc-web typecheck    # tsc --noEmit
pnpm --filter ucmc-web knip         # unused files, exports and dependencies
pnpm --filter ucmc-web db:drift     # fails if schema.ts has changes no migration covers
pnpm --filter ucmc-web storybook    # Storybook on http://localhost:6006
pnpm --filter ucmc-web deploy:dev   # build and deploy to dev (dev.ucmc.spencerwill.com)
pnpm --filter ucmc-web deploy:prod  # build and deploy to prod (ucmc.spencerwill.com)
pnpm --filter ucmc-web sync-env --stack dev --outputs <file> [--dry-run]  # point wrangler.jsonc at a Pulumi stack
pnpm --filter ucmc-web db:migrate:local  # apply migrations to the local Miniflare D1
pnpm --filter ucmc-web db:seed:local     # promote SEED_ADMIN_EMAIL to system_admin (local only)
```

#### Authentication

The app uses a two-path authentication system:

1. **Magic links** (primary for registration, fallback for sign-in) — enter an email, receive a one-time link that expires in 15 minutes. The link lands on a click-through page (to defeat email scanners), then either opens a session (existing user) or sets a short-lived proof cookie (new user → profile form → pending approval).

2. **Passkeys / WebAuthn** (primary for sign-in) — FIDO2 passkeys are managed on `/my/security` and offered in two places ahead of it: on `/register/pending`, since enrollment needs a session but **not** an approved account, and as a dismissible nudge on `/my/profile` for anyone still holding none — which is the only offer an officer pre-added member ever sees, since they skip the pending page entirely. They stay optional: magic links remain the sign-in and recovery path, and plenty of people register on a machine that can't create a passkey at all. The sign-in page runs a conditional-UI ceremony in the background: if the browser has a passkey, it appears in the email field's autofill menu and skips the magic link entirely.

**Registration flow**: `/sign-in` (one page for signing in and joining; the server registers any email it hasn't seen) → magic link → `/auth/callback` (click-through) → `/register/profile` (required fields only: legal + preferred name, phone, UC affiliation, policies ack) → `/register/pending` (wait for exec approval; optionally add a passkey, emergency contacts and a bio there) → exec approves at `/members/pending` → user is `approved` with the `member` role.

**Anti-abuse**: Turnstile CAPTCHA on the magic-link form, per-IP + per-email rate limiting (10 req / 60 s), timing jitter (500–800 ms) to prevent email enumeration, SHA-256 hashed tokens in D1 (stolen DB can't replay links).

#### Local env (`.env.local`)

Copy `apps/ucmc-web/.env.example` to `apps/ucmc-web/.env.local` and fill in the values. Wrangler v4 (via `@cloudflare/vite-plugin`) loads this automatically during `pnpm --filter ucmc-web dev`. It is gitignored — never commit it.

The full precedence chain (most → least specific, merged) is `.env.<mode>.local` > `.env.local` > `.env.<mode>` > `.env`. The devcontainer also sets `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` in `docker-compose.yml`, so exporting a var in your host shell (e.g. `export SESSION_SECRET=…`) overrides whatever is in `.env.local` — useful for keeping per-developer secrets out of the workspace entirely.

`.env.local` is the local analog of the Worker vars and secrets a deploy sets from Pulumi and the GitHub environments. Missing any required value will crash the Worker on first request that touches it.

Notable vars: `VITE_TURNSTILE_SITE_KEY` (client-side — leave unset to skip the Turnstile widget in local dev, or use Cloudflare's [always-pass test key](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) for integration testing).

#### Worker secrets (deployed envs)

Non-secret runtime vars come from Pulumi stack outputs: `sync-env` writes them into the stack's section of `wrangler.jsonc` before the build. Secrets ride along with the same Worker version through `wrangler deploy --secrets-file`, written by the deploy action (`.github/actions/deploy`) from the GitHub environment and Pulumi's secret outputs, so code and secrets change together. That means **secrets live in GitHub Actions environment secrets**, not in Cloudflare directly: set them once under the `dev` and `prod` GitHub environments and every deploy re-applies them to the Worker. An optional secret left unset keeps whatever value the Worker already has, so to turn one off (the feedback mirror, the cost snapshot), also `wrangler secret delete <NAME> [--env production]` once by hand.

Required per-environment secrets (repo Settings → Environments → `dev` / `prod` → Environment secrets):

| Name                            | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Generate with                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `SESSION_SECRET`                | HMAC signing key for the email-verification proof cookie. Rotating invalidates outstanding proofs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `openssl rand -base64 48`         |
| `RESEND_API_KEY`                | **Prod only.** Resend sending key for transactional email, issued by the shared [spencerwill.com](https://github.com/SpencerAWill/spencerwill.com) stack and read by prod's Pulumi stack (#298); prod sends as `ucmc@spencerwill.com`. Dev has none: its email goes to the outbox at `/dev/outbox`, behind Cloudflare Access ([ADR 0001](docs/adr/0001-dev-email-outbox.md)). Locally the Worker uses Mailpit at `MAILPIT_URL`; with no provider configured `sendEmail` **throws** rather than silently succeeding, so a misconfigured prod fails loudly instead of swallowing magic links. | Pulumi (`resendApiKey`)           |
| `TURNSTILE_SECRET_KEY`          | Cloudflare Turnstile server-side verification key. Leaving it unset skips verification (local dev). Required in prod to prevent bot registrations.                                                                                                                                                                                                                                                                                                                                                                                                                                          | Cloudflare dashboard              |
| `CLOUDFLARE_ACCOUNT_READ_TOKEN` | Account-scoped **read-only** token for the daily cost/usage snapshot (#268). Needs five scopes: Billing Read, Workers Scripts Read, D1 Read, Workers KV Storage Read, Account Analytics Read — the three product scopes are each required for their own GraphQL dataset, which Account Analytics Read does _not_ cover. Optional: unset simply skips the snapshot task. It reads telemetry for the **whole account**, so it is used only by the cron and never by a route handler.                                                                                                          | Cloudflare dashboard → API Tokens |

The CI credentials (the scoped Cloudflare tokens, Pulumi's OIDC login, and the `CLOUDFLARE_ACCOUNT_ID` variable) are covered under **GitHub as code** in the Infrastructure section below. The Worker additionally receives `CLOUDFLARE_ACCOUNT_ID` as a var from the Pulumi stack output `cloudflareAccountId` — it is an identifier rather than a secret, and sourcing it per stack keeps dev and prod free to live in different accounts.

### Infrastructure

Infrastructure is managed with [Pulumi](https://www.pulumi.com/) in `infra/cloudflare/`, with two stacks:

- **dev** — `pulumi up` on every merge to `main`, as the first step of the dev deploy
- **prod** — the same, in the same pipeline run, once a reviewer approves

On pull requests that touch `infra/cloudflare/`, CI runs ESLint, TypeScript type-checking, and a Pulumi preview of each stack (one PR comment per stack). The preview waits for a reviewer's approval, and Dependabot PRs skip it.

To preview or deploy locally:

```bash
cd infra/cloudflare
pulumi preview    # see planned changes
pulumi up         # apply changes
```

#### Pipeline (`cicd.yml`)

One workflow, `CI/CD`, checks every change and deploys `main` ([ADR 0002](docs/adr/0002-one-pipeline-from-check-to-prod.md), #312):

1. **Checks.** On a PR they're path-filtered; on a push to `main` every check runs, since the merged tree is what deploys. The `required` job aggregates them, and it is the only status check the ruleset names.
2. **`Deploy — dev`** after `required` passes, on every push to `main`.
3. **`Deploy — prod`** after dev deployed and passed its smoke test, waiting in the same run for a reviewer on the `prod` environment. Approve the newest waiting run; it contains everything before it.

Both deploy jobs run the composite action `.github/actions/deploy`: `pulumi up`, `sync-env`, build, the secrets file, a **D1 restore point** (a Time Travel bookmark, with the restore command, in the job summary), `d1 migrations apply`, `wrangler deploy --secrets-file`, and the Playwright smoke test. **On prod, a smoke test that fails (or never runs) after the deploy runs `wrangler rollback`**: the Worker's code, vars and secrets go back one version; D1 does not, which is why migrations must only add. To undo a migration, restore D1 from the bookmark in the run's summary.

`workflow_dispatch` re-runs the whole pipeline for `main`'s head, as a break-glass redeploy. `sync-env` (`pnpm --filter ucmc-web sync-env --stack <dev|prod> --outputs <file>`) can be run locally with `--dry-run` against `pulumi stack output --json`.

#### GitHub as code (`infra/github`)

This repo's GitHub settings and CI credentials are the Pulumi program in `infra/github` (stack `main`, #311). **A repo admin applies it locally; CI never runs it.** The Actions `GITHUB_TOKEN` can't change repo settings or write secrets, and CI shouldn't hold a credential that can loosen its own rules.

What it manages:

- **The repository's settings**: squash-only merges titled from the PR, secret scanning and push protection, Dependabot alerts and security updates. It must stay public: on GitHub Free, rulesets, environment secrets and required reviewers exist for a personal account's repos only when they're public.
- **The `Main Protection` ruleset**: changes to `main` arrive by PR, after `cicd.yml`'s aggregate **`required`** job passes against the latest `main`, with linear history and no deletion. Repository admins can bypass, so a broken CI can't lock anyone out.
- **Environments**: `dev` and `prod` deploy from `main` only, and `prod` waits for a reviewer. `preview` (PR previews) also waits for a reviewer.
- **Least-privilege Cloudflare tokens**, minted by Pulumi and written as environment secrets:

  | Secret                         | Environments | Used by                                                             |
  | ------------------------------ | ------------ | ------------------------------------------------------------------- |
  | `CLOUDFLARE_DEPLOY_API_TOKEN`  | dev, prod    | wrangler in the deploy action and `seed-admin.yml` (no zone access) |
  | `CLOUDFLARE_INFRA_API_TOKEN`   | dev, prod    | `pulumi up` on `infra/cloudflare`                                   |
  | `CLOUDFLARE_PREVIEW_API_TOKEN` | preview      | `pulumi preview` on PRs (read-only)                                 |

  Permissions are listed in `infra/github/src/cloudflare-tokens.ts`; add one there in the same PR as whatever needs it.

- **Repository variables**: `CLOUDFLARE_ACCOUNT_ID`, plus `PULUMI_ORGANIZATION` and `PULUMI_USER_LOGIN` for the OIDC login.

**Pulumi has no stored token.** Every job that runs Pulumi declares an environment and exchanges its GitHub OIDC token for a Pulumi token lasting at most an hour (`pulumi/auth-actions`). The issuer and its trust policies are in [SpencerAWill/spencerwill.com](https://github.com/SpencerAWill/spencerwill.com)'s `infra/github` (`pulumiOidcRepositories`), which lists this repo's `dev`, `prod` and `preview`. The token is personal, so it can read every stack's secrets in every repo: **approve a PR preview only for a branch whose changes you have read.**

Hand-managed, deliberately: the environment secrets `SESSION_SECRET` (rotating it signs everyone out) and `CLOUDFLARE_ACCOUNT_READ_TOKEN` (the cost cron), and `SITE_FEEDBACK_GITHUB_TOKEN` / `SITE_FEEDBACK_GITHUB_REPO`. GitHub never reveals a secret's value, so adopting one into Pulumi means re-entering it.

**Day to day**, from `infra/github`: `pnpm preview` then `pnpm apply` (both use `gh auth token` for GitHub). To rotate a Cloudflare token, `pnpm apply --replace <token URN>`.

**First-time setup** (done once, recorded for rebuilding):

1. Switch the repo to GitHub's immutable OIDC subject, which the trust policies match on: `gh api -X PUT repos/SpencerAWill/ucmc.spencerwill.com/actions/oidc/customization/sub -F use_default=true -F use_immutable_subject=true`.
2. In spencerwill.com, add `"SpencerAWill/ucmc.spencerwill.com": ["dev", "prod", "preview"]` to `pulumiOidcRepositories` and apply its `infra/github`.
3. Here: `cd infra/github && pulumi stack init SpencerAWill/ucmc-github/main`, then `pulumi config set --secret cloudflare:apiToken` with a token allowed to create account API tokens (**Account API Tokens Write**).
4. `pnpm adopt` imports the existing repository, ruleset and `dev`/`prod` environments into state (`adopt.json`). `pnpm preview` must then show **no change to the repository resource**: every setting is declared to match what the repo already has. The ruleset gains the PR and `required` rules; the rest are creates.
5. `pnpm apply`. The new secrets have new names, so `main`'s workflows keep using the old repo-level ones until the workflow change merges.
6. Once a deploy has logged in through OIDC and used the new tokens, delete the repo-level `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `PULUMI_ACCESS_TOKEN` secrets, and revoke the old Cloudflare token and Pulumi access token.

#### Bootstrapping `infra/cloudflare`

- **Per-environment secrets**: `SESSION_SECRET` lives on the `dev` and `prod` environments. `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY` come from Pulumi stack outputs instead, and dev has no `RESEND_API_KEY` at all. The deploy action uploads them with the Worker version (`--secrets-file`) on every deploy. See **Worker secrets (deployed envs)** above for details.
- **Dev email outbox** ([ADR 0001](docs/adr/0001-dev-email-outbox.md)): the dev stack creates a Cloudflare Access application on `/dev/outbox`, which is why the infra token has account-level **Access: Apps and Policies Write**. The Zero Trust organization itself, and its login methods, are configured by hand and shared with the account's other projects; a viewer who isn't a member of the Cloudflare account needs One-time PIN enabled.
- **Stack init** (one-time): `cd infra/cloudflare && pulumi stack init dev && pulumi stack init prod`
- **Stack config** (one-time): fill in `REPLACE_WITH_…` placeholders in `infra/cloudflare/Pulumi.dev.yaml` and `infra/cloudflare/Pulumi.prod.yaml` with the Cloudflare Account ID and `spencerwill.com` Zone ID (both visible in the Cloudflare dashboard).
- **Bootstrap order** (a brand-new stack only): the Worker must exist before `pulumi up`, because the custom-domain binding references the script. The deploy action runs `pulumi up` first, so deploy a new stack's Worker once by hand first: `pulumi up --target` its D1 database and KV namespace, `sync-env` against that stack's outputs, then `pnpm --filter ucmc-web deploy:dev` (or `deploy:prod`). After that the pipeline's infra → Worker order applies on every run.

### Wiki

Reference and compliance documentation lives in the [GitHub wiki](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki), which is edited on GitHub and is **not** checked out into this repo. Of particular note: the [compliance matrix](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki/Compliance) maps each legal/policy obligation to the file or route that satisfies it.
