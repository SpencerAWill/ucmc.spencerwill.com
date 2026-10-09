# ucmc.spencerwill.com

The University of Cincinnati Mountaineering Club's software system.

## Repository Structure

This is a polyglot pnpm monorepo with the following workspace layout:

- `apps/` — Applications
  - `apps/ucmc-web/` — UCMC web app (TanStack Start on Cloudflare Workers)
- `infra/` — Pulumi infrastructure-as-code
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
- Claude Code CLI
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

All pnpm config (`overrides`, `peerDependencyRules`, `auditConfig`, `minimumReleaseAge`, `allowBuilds`) lives in `pnpm-workspace.yaml`. pnpm 11 stopped reading the `pnpm.*` block in `package.json`, so a stale entry there is a silent no-op.

Two policies are load-bearing for security and should not be relaxed casually:

- **`minimumReleaseAge: 10080`** — pnpm refuses to install any version published in the last 7 days. This catches publish-compromise incidents (a hijacked `latest` tag, a poisoned `postinstall`) before they land in the tree. Because of this, every direct dep is pinned to a specific version that's already older than 7 days. **Never use `"latest"` as a version spec.** If you need to bump a dep, set the exact version in `package.json` and re-run `pnpm install` — pnpm will reject anything fresher than the quarantine window.
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

On every commit, the following runs automatically via lint-staged:

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
pnpm verify        # lint + typecheck + knip + test, every package (~70s)

# or individually
pnpm lint
pnpm typecheck
pnpm knip
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

The web app lives in `apps/ucmc-web/` and is built with [TanStack Start](https://tanstack.com/start) (React 19, Vite, Tailwind v4, shadcn). It is deployed to Cloudflare Workers via Wrangler, with two environments: **dev** at `dev.ucmc.spencerwill.com` (worker `ucmc-web-dev`) and **prod** at `ucmc.spencerwill.com` (worker `ucmc-web`). Custom domains are provisioned by Pulumi (see Infrastructure below); dev auto-deploys on merge to main, prod is a manual dispatch with environment approval.

Dates and times use the TC39 [Temporal](https://tc39.es/proposal-temporal/docs/) API (via `temporal-polyfill`, since workerd and Safari < 17 lack it natively) rather than `Date`. Calendar-shaped rules (waiver cycle, gear due dates) reason in the club's `America/New_York` zone; see [`.claude/rules/dates-and-formats.md`](.claude/rules/dates-and-formats.md) for the invariants.

Phone numbers are stored in E.164 (`+15135551234`) and validated with [`react-phone-number-input`](https://gitlab.com/catamphetamine/react-phone-number-input) (a `libphonenumber-js` wrapper) on the way in; every rendered number goes through `#/lib/phone-format`, which shows US numbers in national form (`(513) 555-1234`), keeps the country code on everything else, and pairs with the `<PhoneLink>` component for click-to-call.

Every public page (`/`, `/gear-cave`, `/policies`, `/scholarships`, `/resources`, `/volunteer`, `/sponsors`, `/history`, `/album`, `/gazette`, `/calendar`) renders a configurable **hero** — editable title and description over an optional auto-advancing image gallery, with hover-revealed arrows and a clock-face autoplay dial that doubles as the pause control. Adding a hero to a new page is one entry in the `HERO_PAGES` registry; see [`.claude/rules/feature-public-pages.md`](.claude/rules/feature-public-pages.md).

Public pages include a **volunteer** page (`/volunteer`) — standing service programs, upcoming outings, and a date-derived archive of everything the club has logged — and a **sponsors** page (`/sponsors`) listing the businesses that back UCMC, each with its logo, what it does for the club, and an officer-editable pitch for prospective sponsors. Sponsor logos are scaled to fit rather than cropped, so a wordmark and a roundel each keep their own shape. Member-only sponsor perks (discounts, codes, how to claim) sit behind their own `public_sponsors:perks` permission and are **stripped from the payload server-side** for anyone who lacks it, so they never reach a signed-out visitor's page source.

Member-facing features include: registration + waiver workflow, feedback, paper-waiver attestation, member directory + management, and a **gear inventory** (`/gear`) with type/tag partitioning (tags can be public or officer-only-`internal`), freeform short codes that print to laminated tags and recycle on retirement, CSV bulk import, per-piece append-only inspection log (pass/fail/advisory), and officer-only barcode label printing (CODE128 via `jsbarcode`). A **gear-loans / checkout** flow on top of the inventory lets a gear-cave keeper (`gear:loan` permission) check pieces out to members at a desk via USB keyboard-wedge scanner, camera barcode scan, or code search, with per-loan due dates and an asymmetric check-in batch that can span multiple borrowers. Members see their own loans at `/my/gear`. **Trip sign-ups** (`/trips`) are a temporary surface that embeds the club's existing Google Form, so members have an in-app place to sign up while the full trips feature is built; see [`.claude/rules/feature-public-pages.md`](.claude/rules/feature-public-pages.md) for what comes out when it lands. Officers can **backfill** historical loans in bulk from a CSV (file, clipboard, or manual entry) — keyed on member primary email + gear `code`, supporting both open and already-returned rows in the same import. A daily job emails borrowers as a loan comes due and as it goes overdue, escalating through the same flag and block thresholds the gear desk enforces, so nobody first learns they're blocked at the counter; it ships behind the `gear.remindersEnabled` switch. Members choose what the club emails them about on `/my/preferences` — though notices about overdue club gear they're holding are not opt-out-able. See [`.claude/rules/notifications.md`](.claude/rules/notifications.md). A **club calendar** (`/calendar`) shows meetings, trips and club events as a month grid with an agenda beside it, with officers creating and editing events — including repeating ones — inline on the same page. The same events are published as subscribable **iCal feeds**: an anonymous one carrying public events, and a per-member one behind a revocable token that a member adds to Apple Calendar, Google Calendar or Outlook once from `/my/calendar` and then never thinks about again. Events carry a three-tier visibility (`public` / `members` / `officers`) that is enforced in SQL on both surfaces, and the feeds resolve what a subscriber may see on every fetch, so a role change takes effect on their next poll. `/calendar` itself is public: an anonymous visitor sees the events officers marked public and can subscribe to a **public feed** carrying exactly those, with no account and nothing to revoke. Events default to members-only, so opening the page does not open its contents. See [`.claude/rules/feature-calendar.md`](.claude/rules/feature-calendar.md).

Common commands (run from the repo root):

```bash
pnpm --filter ucmc-web dev          # start the dev server on http://localhost:3000
pnpm --filter ucmc-web build        # production build
pnpm --filter ucmc-web test         # run Vitest unit tests (both pools)
pnpm --filter ucmc-web test:coverage     # same, with an Istanbul coverage report
pnpm --filter ucmc-web test:mutation     # Stryker mutation testing (pure modules only)
pnpm --filter ucmc-web typecheck    # tsc --noEmit
pnpm --filter ucmc-web knip         # unused files, exports and dependencies
pnpm --filter ucmc-web storybook    # Storybook on http://localhost:6006
pnpm --filter ucmc-web deploy:dev   # build and deploy to dev (dev.ucmc.spencerwill.com)
pnpm --filter ucmc-web deploy:prod  # build and deploy to prod (ucmc.spencerwill.com)
pnpm --filter ucmc-web db:migrate:local  # apply migrations to the local Miniflare D1
pnpm --filter ucmc-web db:seed:local     # promote SEED_ADMIN_EMAIL to system_admin (local only)
```

#### Authentication

The app uses a two-path authentication system:

1. **Magic links** (primary for registration, fallback for sign-in) — enter an email, receive a one-time link that expires in 15 minutes. The link lands on a click-through page (to defeat email scanners), then either opens a session (existing user) or sets a short-lived proof cookie (new user → profile form → pending approval).

2. **Passkeys / WebAuthn** (primary for sign-in) — FIDO2 passkeys are managed on `/my/security` and offered in two places ahead of it: on `/register/pending`, since enrollment needs a session but **not** an approved account, and as a dismissible nudge on `/my/profile` for anyone still holding none — which is the only offer an officer pre-added member ever sees, since they skip the pending page entirely. They stay optional: magic links remain the sign-in and recovery path, and plenty of people register on a machine that can't create a passkey at all. The sign-in page runs a conditional-UI ceremony in the background: if the browser has a passkey, it appears in the email field's autofill menu and skips the magic link entirely.

**Registration flow**: `/sign-in?register=1` → magic link → `/auth/callback` (click-through) → `/register/profile` (required fields only: legal + preferred name, phone, UC affiliation, policies ack) → `/register/pending` (wait for exec approval; optionally add a passkey, emergency contacts and a bio there) → exec approves at `/members/pending` → user is `approved` with the `member` role.

**Anti-abuse**: Turnstile CAPTCHA on the magic-link form, per-IP + per-email rate limiting (10 req / 60 s), timing jitter (500–800 ms) to prevent email enumeration, SHA-256 hashed tokens in D1 (stolen DB can't replay links).

#### Local env (`.env.local`)

Copy `apps/ucmc-web/.env.example` to `apps/ucmc-web/.env.local` and fill in the values. Wrangler v4 (via `@cloudflare/vite-plugin`) loads this automatically during `pnpm --filter ucmc-web dev`. It is gitignored — never commit it.

The full precedence chain (most → least specific, merged) is `.env.<mode>.local` > `.env.local` > `.env.<mode>` > `.env`. The devcontainer also sets `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` in `docker-compose.yml`, so exporting a var in your host shell (e.g. `export SESSION_SECRET=…`) overrides whatever is in `.env.local` — useful for keeping per-developer secrets out of the workspace entirely.

`.env.local` is the local analog of what Pulumi-injected `--var` flags and Cloudflare secrets do in deployed envs. Missing any required value will crash the Worker on first request that touches it.

Notable vars: `VITE_TURNSTILE_SITE_KEY` (client-side — leave unset to skip the Turnstile widget in local dev, or use Cloudflare's [always-pass test key](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) for integration testing).

#### Worker secrets (deployed envs)

Non-secret runtime vars are injected at deploy time from Pulumi stack outputs. Secrets can't ride along in `--var` — they're uploaded separately via `wrangler secret put`, automated per deploy by the `deploy.yml` workflow through `cloudflare/wrangler-action`'s `secrets:` field. That means **secrets live in GitHub Actions environment secrets**, not in Cloudflare directly: set them once under the `dev` and `prod` GitHub environments and every deploy re-applies them to the Worker.

Required per-environment secrets (repo Settings → Environments → `dev` / `prod` → Environment secrets):

| Name                   | Purpose                                                                                                                                                                                                                                                                     | Generate with             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `SESSION_SECRET`       | HMAC signing key for the email-verification proof cookie. Rotating invalidates outstanding proofs.                                                                                                                                                                          | `openssl rand -base64 48` |
| `RESEND_API_KEY`       | Resend API key for transactional email. Unset, the Worker falls back to Mailpit at `MAILPIT_URL` (the dev sidecar); with neither configured `sendEmail` **throws** rather than silently succeeding, so a misconfigured prod fails loudly instead of swallowing magic links. | Resend dashboard          |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile server-side verification key. Leaving it unset skips verification (local dev). Required in prod to prevent bot registrations.                                                                                                                          | Cloudflare dashboard      |

`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `PULUMI_ACCESS_TOKEN` are also required but are covered under **Required GitHub setup** in the Infrastructure section below.

### Infrastructure

Infrastructure is managed with [Pulumi](https://www.pulumi.com/) in the `infra/` directory, with two stacks:

- **dev** — auto-deployed when changes to `infra/` merge to `main`
- **prod** — deployed manually via GitHub Actions with environment approval

On pull requests that touch `infra/`, CI runs ESLint, TypeScript type-checking, and a Pulumi preview (posted as a PR comment).

To preview or deploy locally:

```bash
cd infra
pulumi preview    # see planned changes
pulumi up         # apply changes
```

#### Required GitHub setup

- **Environments**: Create `dev` (no protection) and `prod` (required reviewers) in repo Settings > Environments
- **Repo-level secrets**: Add `PULUMI_ACCESS_TOKEN` and `CLOUDFLARE_API_TOKEN` in repo Settings > Secrets and variables > Actions. Also set `CLOUDFLARE_ACCOUNT_ID` (used by `deploy.yml`). The Cloudflare API token needs these scopes: Workers Scripts (Edit), Workers R2 Storage (Edit), Workers KV Storage (Edit), D1 (Edit), Account Settings (Read), Zone DNS (Edit), Workers Routes (Edit), and SSL and Certificates (Edit) for the `spencerwill.com` zone.
- **Per-environment secrets**: `SESSION_SECRET` and `RESEND_API_KEY` live on the `dev` and `prod` environments (Settings > Environments > `{env}` > Environment secrets). `deploy.yml` uploads them to the corresponding Worker via `wrangler secret put` on every deploy. See **Worker secrets (deployed envs)** above for details.
- **Stack init** (one-time): `cd infra && pulumi stack init dev && pulumi stack init prod`
- **Stack config** (one-time): fill in `REPLACE_WITH_…` placeholders in `infra/Pulumi.dev.yaml` and `infra/Pulumi.prod.yaml` with the Cloudflare Account ID and `spencerwill.com` Zone ID (both visible in the Cloudflare dashboard).
- **Bootstrap order** (first deploy only): `wrangler deploy` must run before `pulumi up` for a given stack, because the custom-domain binding references a worker script that must already exist. From `deploy.yml` (workflow_dispatch), bootstrap requires running the web job before the infra job — for the first dev deploy, manually dispatch with `environment=dev` after temporarily commenting out the `needs: infra-dev` line on `web-dev`; restore after the worker exists. Repeat for prod. After bootstrap the standard infra → web order applies on every push and dispatch.

### Wiki

Reference and compliance documentation lives in the [GitHub wiki](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki), which is edited on GitHub and is **not** checked out into this repo. Of particular note: the [compliance matrix](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki/Compliance) maps each legal/policy obligation to the file or route that satisfies it.
