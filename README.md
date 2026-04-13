# ucmc.spencerwill.com

The University of Cincinnati Mountaineering Club's software system.

## Repository Structure

This is a polyglot pnpm monorepo with the following workspace layout:

- `apps/` — Applications
  - `apps/web/` — UCMC web app (TanStack Start on Cloudflare Workers)
- `libs/` — Shared libraries
- `infra/` — Pulumi infrastructure-as-code
- `.devcontainer/` — Dev container configuration
- `.wiki/` — GitHub wiki (git submodule, auto-synced)

## Development Setup

### Dev Container (Recommended)

The easiest way to get started is with the included [dev container](https://containers.dev/), which works with VS Code, GitHub Codespaces, and any devcontainer-compatible tool.

The container provides:

- Node.js 22
- pnpm (via corepack)
- Pulumi CLI
- GitHub CLI
- Claude Code CLI
- VS Code extensions: Prettier, ESLint, EditorConfig

Named Docker volumes persist the pnpm store, Pulumi config, GitHub CLI config, and Claude data across container rebuilds.

To use it, open the repo in VS Code and select **Reopen in Container** when prompted, or run `Dev Containers: Reopen in Container` from the command palette.

### Manual Setup

#### Prerequisites

- [Node.js](https://nodejs.org/) (v22+)
- [pnpm](https://pnpm.io/) (v10.33.0+)
- [Pulumi CLI](https://www.pulumi.com/docs/install/) (for infrastructure changes)

#### Getting Started

```bash
git clone --recurse-submodules <repo-url>
pnpm install
```

If you already cloned without `--recurse-submodules`, `pnpm install` will initialize the wiki submodule automatically.

This also sets up Git hooks via Husky.

### Committing

This repository enforces [Conventional Commits](https://www.conventionalcommits.org/). Commit messages must follow the format:

```
type(scope): description
```

Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

Scopes are validated against workspace package names, plus `wiki` and `devcontainer` for cross-cutting changes.

To use the interactive commit helper:

```bash
pnpm commit
```

### Linting and Formatting

On every commit, the following runs automatically via lint-staged:

- **ESLint** — lints and fixes `*.js`, `*.ts`, `*.tsx` files
- **Prettier** — formats all supported file types

To run manually:

```bash
pnpm exec eslint .
pnpm exec prettier --write .
```

### Web App

The web app lives in `apps/web/` and is built with [TanStack Start](https://tanstack.com/start) (React 19, Vite, Tailwind v4, shadcn). It is deployed to Cloudflare Workers via Wrangler, with two environments: **dev** at `dev.ucmc.spencerwill.com` (worker `ucmc-web-dev`) and **prod** at `ucmc.spencerwill.com` (worker `ucmc-web`). Pulumi owns the D1 database, the custom domain binding, and the per-env `vars` values (injected into `wrangler deploy --var` by CI); wrangler deploys the worker script itself and manages secrets (`wrangler secret put`). Dev auto-deploys on merge to main, prod is a manual dispatch with environment approval.

Common commands (run from the repo root):

```bash
pnpm --filter ucmc-web dev          # start the dev server on http://localhost:3000
pnpm --filter ucmc-web build        # production build
pnpm --filter ucmc-web test         # run Vitest unit tests
pnpm --filter ucmc-web typecheck    # tsc --noEmit
pnpm --filter ucmc-web storybook    # Storybook on http://localhost:6006
pnpm --filter ucmc-web deploy:dev   # build and deploy to dev (dev.ucmc.spencerwill.com)
pnpm --filter ucmc-web deploy:prod  # build and deploy to prod (ucmc.spencerwill.com)
```

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
- **Secrets**: Add `PULUMI_ACCESS_TOKEN` and `CLOUDFLARE_API_TOKEN` in repo Settings > Secrets and variables > Actions. Also set `CLOUDFLARE_ACCOUNT_ID` (used by `web-deploy.yml`). `web-deploy.yml` additionally needs `PULUMI_ACCESS_TOKEN` available in the `dev` and `prod` environments so it can read stack outputs — add it to each environment's secrets, not just repo-level. The Cloudflare API token needs these scopes: Workers Scripts (Edit), Account Settings (Read), Zone DNS (Edit), Workers Routes (Edit), D1 (Edit), and SSL and Certificates (Edit) for the `spencerwill.com` zone.
- **Stack init** (one-time): `cd infra && pulumi stack init dev && pulumi stack init prod`
- **Stack config** (one-time): `infra/Pulumi.dev.yaml` and `infra/Pulumi.prod.yaml` hold non-secret per-env values (account ID, zone ID, hostname, worker name, D1 database name, display names). These are already populated; adjust if the domain or display names ever change.
- **Bootstrap order** (first deploy for a new stack):
  1. `cd infra && pulumi up --target 'urn:pulumi:<stack>::ucmc-infra::cloudflare:index/d1Database:D1Database::ucmc-web-<stack>-db'` — creates the D1 database only. Skipping `--target` on a fresh stack fails because `WorkersCustomDomain` references a worker that doesn't exist yet.
  2. Copy the UUID from `pulumi stack output d1DatabaseId` into the matching `database_id` field in `apps/web/wrangler.jsonc`, commit.
  3. Trigger `web-deploy.yml` for the stack — deploys the worker, which reads the remaining Pulumi outputs (`appBaseUrl`, `webauthnRpId`, etc.) and sets them as `--var`.
  4. `pulumi up` — now completes the `WorkersCustomDomain` binding.
  5. Set runtime secrets: `wrangler secret put RESEND_API_KEY --env <dev|production> --cwd apps/web`.
     After bootstrap, `web-deploy.yml` and `infra-deploy.yml` run independently on their own triggers.

### Wiki

The GitHub wiki is included as a git submodule at `.wiki/`. It syncs automatically on pull, checkout, and install. A GitHub Action also keeps it updated.

To push local wiki edits:

```bash
pnpm wiki:push
```

This also happens automatically when you `git push` the main repo (via the pre-push hook).
