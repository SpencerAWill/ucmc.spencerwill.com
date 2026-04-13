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

The web app lives in `apps/web/` and is built with [TanStack Start](https://tanstack.com/start) (React 19, Vite, Tailwind v4, shadcn). It is deployed to Cloudflare Workers via Wrangler.

Common commands (run from the repo root):

```bash
pnpm --filter ucmc-web dev          # start the dev server on http://localhost:3000
pnpm --filter ucmc-web build        # production build
pnpm --filter ucmc-web test         # run Vitest unit tests
pnpm --filter ucmc-web typecheck    # tsc --noEmit
pnpm --filter ucmc-web storybook    # Storybook on http://localhost:6006
pnpm --filter ucmc-web deploy       # build and deploy to Cloudflare Workers
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
- **Secrets**: Add `PULUMI_ACCESS_TOKEN` in repo Settings > Secrets and variables > Actions
- **Stack init** (one-time): `cd infra && pulumi stack init dev && pulumi stack init prod`

### Wiki

The GitHub wiki is included as a git submodule at `.wiki/`. It syncs automatically on pull, checkout, and install. A GitHub Action also keeps it updated.

To push local wiki edits:

```bash
pnpm wiki:push
```

This also happens automatically when you `git push` the main repo (via the pre-push hook).
