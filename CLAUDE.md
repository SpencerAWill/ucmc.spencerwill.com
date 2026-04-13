# CLAUDE.md

## Project Overview

This is the software system for the University of Cincinnati Mountaineering Club (UCMC). It is a polyglot pnpm monorepo.

## Repository Structure

- `apps/` — Applications (sub-apps with their own configs)
  - `apps/web/` — UCMC web app (TanStack Start, React 19, Vite, Tailwind v4, deployed to Cloudflare Workers via Wrangler)
- `libs/` — Shared libraries
- `infra/` — Pulumi infrastructure-as-code (TypeScript)
- `.devcontainer/` — Dev container configuration (Dockerfile, docker-compose, devcontainer.json)
- `.wiki/` — GitHub wiki content (git submodule, auto-synced locally and via CI)
- Root contains shared tooling and configuration

## Package Manager

- **pnpm** (v10.33.0+) with workspaces
- Workspace packages defined in `pnpm-workspace.yaml`
- All modules are ESM (`"type": "module"` in package.json)

## Dev Container

- Config in `.devcontainer/` (Dockerfile, docker-compose.yml, devcontainer.json)
- Base image: `mcr.microsoft.com/devcontainers/base:debian`
- Installs Node.js 22 (via devcontainer feature), Pulumi CLI, GitHub CLI, and Claude Code CLI
- `postCreateCommand` runs `corepack enable`, initializes the wiki submodule, and runs `pnpm install`
- Named Docker volumes persist: pnpm store, Pulumi config (`~/.pulumi`), GitHub CLI config (`~/.config/gh`), Claude data (`~/.claude`), shell history (`/commandhistory`, symlinked to `~/.bash_history` and `~/.zsh_history`)
- Static image-wide env is set via Dockerfile `ENV`: `CLAUDE_CONFIG_DIR=/home/vscode/.claude` (so Claude Code's account/auth config — normally at `~/.claude.json` — lives inside the mounted `claude-data` volume and survives rebuilds), `NODE_OPTIONS=--max-old-space-size=4096`, `DEVCONTAINER=true`, and `PATH` extended with `~/.pulumi/bin`
- Host-dynamic env stays in devcontainer.json `containerEnv`: `TZ` reads from `${localEnv:TZ:America/New_York}` so it tracks the developer's laptop without rebuilding the image
- VS Code extensions auto-installed: Prettier, ESLint, EditorConfig
- `.dockerignore` excludes `node_modules/`, `.git/`, `.wiki/`, build outputs, and env files from the build context

## Tooling

### Linting & Formatting

- **ESLint** (v10, flat config) — JS/TS code quality. Config in `eslint.config.js`.
  - Uses `@eslint/js` recommended rules as a base
  - `eslint-config-prettier` disables formatting rules that conflict with Prettier
  - Scoped to `*.{js,mjs,cjs,ts,tsx}` files
  - Sub-apps may extend the root config with language-specific rules (e.g. `typescript-eslint`)
- **Prettier** — formatting for all supported file types. Config in `.prettierrc`.
- **EditorConfig** — editor-level formatting defaults in `.editorconfig`

### Git Hooks

- **Husky** — manages git hooks in `.husky/`
  - `pre-commit` — runs lint-staged (ESLint + Prettier on staged files)
  - `commit-msg` — runs commitlint to enforce conventional commits
  - `post-merge` — auto-updates the wiki submodule
  - `post-checkout` — auto-updates the wiki submodule
  - `pre-push` — pushes unpushed wiki submodule commits before pushing the main repo
- **lint-staged** — configured in `package.json` under `"lint-staged"`
  - `*.{js,ts,tsx}` — ESLint --fix, then Prettier --write
  - `*` — Prettier --write --ignore-unknown (catch-all for all other files)

### CI / GitHub Actions

- **Sync Wiki Submodule** (`sync-wiki.yml`) — updates the `.wiki/` submodule pointer on wiki edits (`gollum` event), 1st and 15th of each month at 06:00 UTC, or manual dispatch
- **Web Deploy** (`web-deploy.yml`) — deploys the web app to Cloudflare Workers: auto-deploys dev on merge to main (when `apps/web/**`, `libs/**`, or lockfile changes), manual prod deploy via `workflow_dispatch` with GitHub environment approval
- **Lint PR** (`lint-pr.yaml`) — validates PR titles follow conventional commit format
- **Infra CI** (`infra-ci.yml`) — runs ESLint, TypeScript type-checking, and Pulumi preview on PRs that modify `infra/`
- **Infra Deploy** (`infra-deploy.yml`) — deploys infrastructure: auto-deploys dev on merge to main, manual prod deploy via `workflow_dispatch` with GitHub environment approval

### Web App (`apps/web`)

- **Framework**: TanStack Start (file-router mode) with React 19
- **Build tool**: Vite 8 (config in `apps/web/vite.config.ts`)
- **Styling**: Tailwind CSS v4 (via `@tailwindcss/vite`), shadcn components
- **State/data**: TanStack Query, TanStack Router (with SSR query integration), TanStack Form, TanStack Table
- **Env**: `@t3-oss/env-core` + zod (`apps/web/src/env.ts`)
- **Testing**: Vitest with jsdom and Testing Library
- **Component dev**: Storybook 10 (`pnpm --filter ucmc-web storybook`)
- **Deployment**: Cloudflare Workers via Wrangler (`apps/web/wrangler.jsonc`). Two wrangler environments: `dev` → worker `ucmc-web-dev` at `dev.ucmc.spencerwill.com`, `production` → worker `ucmc-web` at `ucmc.spencerwill.com`.
  - **Wrangler owns:** the Worker script (code, compatibility flags, D1 binding by UUID) and out-of-band secrets (`wrangler secret put RESEND_API_KEY --env <stack>`).
  - **Pulumi owns:** the D1 database itself, the custom domain binding, and all per-env `vars` values (APP_BASE_URL, WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME, RESEND_FROM). `vars` are injected at deploy time by `web-deploy.yml` via `wrangler deploy --var KEY:VALUE`, sourced from Pulumi stack outputs. This keeps the hostname Pulumi binds and the hostname the app advertises from drifting.
  - **D1 UUIDs** are stack outputs from Pulumi and must be pasted into `wrangler.jsonc` once per stack after first `pulumi up`. They're non-secret and stable; the paste is one-time.
- **TS config**: extends bundler resolution with `strict: true`, path alias `#/*` → `./src/*` (also mirrored in `package.json` `imports` for Node-native resolution)
- **ESLint**: extends the root config, then `@tanstack/eslint-config`, with a few TanStack-specific rules relaxed
- **Formatting**: inherits the root `.prettierrc` — do NOT add a sub-app `prettier.config.js` (it would drift from root and lint-staged)

### Infrastructure

- **Pulumi** — IaC in `infra/`, TypeScript with the `nodejs` runtime
  - Project config in `infra/Pulumi.yaml`
  - Stack configs in `infra/Pulumi.<stack>.yaml` (secrets are encrypted, safe to commit)
  - Two stacks: `dev` (auto-deployed on merge) and `prod` (manual deploy with approval)
  - State stored in Pulumi Cloud
  - Uses pnpm as the package manager (`runtime.options.packagemanager: pnpm`)
  - CI/CD via `infra-ci.yml` (PR preview) and `infra-deploy.yml` (deploy)
  - **Cloudflare provider** (`@pulumi/cloudflare`) — manages:
    - Worker custom domain bindings (`dev.ucmc.spencerwill.com`, `ucmc.spencerwill.com`). The `spencerwill.com` zone itself is NOT managed by Pulumi; only the Worker domain records within it are.
    - D1 databases (`ucmc-web-dev`, `ucmc-web`). Protected with `protect: true` — replacing a D1 DB wipes all data.
    - Per-env worker var values, exposed as stack outputs (`appBaseUrl`, `webauthnRpId`, `webauthnRpName`, `resendFrom`) that `web-deploy.yml` reads and passes to `wrangler deploy --var`.
    - Cloudflare auth in CI uses `CLOUDFLARE_API_TOKEN` (env var picked up by the provider)
  - `web-deploy.yml` reads Pulumi stack outputs via `pulumi/setup-pulumi@v2` + `pulumi stack output`, which requires `PULUMI_ACCESS_TOKEN` to be set in the `dev` and `prod` GitHub environments.

### Commits

- **Conventional Commits** enforced via commitlint (`commitlint.config.js`)
- Commit scopes are validated against pnpm workspace package names (via `@commitlint/config-pnpm-scopes`) plus custom scopes: `wiki`, `devcontainer`
- Use `pnpm commit` to launch the interactive commit helper (czg)
- Format: `type(scope): description`
- Valid types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert

## Commands

- `pnpm install` — install dependencies and set up git hooks
- `pnpm commit` — interactive conventional commit helper
- `pnpm exec eslint .` — lint all JS/TS files
- `pnpm exec prettier --write .` — format all files
- `pnpm wiki:push` — push local wiki submodule commits to the wiki remote
- `pnpm --filter ucmc-web dev` — start the web app dev server on port 3000
- `pnpm --filter ucmc-web build` — build the web app
- `pnpm --filter ucmc-web test` — run web app unit tests
- `pnpm --filter ucmc-web typecheck` — type-check the web app
- `pnpm --filter ucmc-web storybook` — start Storybook on port 6006
- `pnpm --filter ucmc-web deploy:dev` — build and deploy to dev (`ucmc-web-dev` worker)
- `pnpm --filter ucmc-web deploy:prod` — build and deploy to prod (`ucmc-web` worker)
- `cd infra && pulumi preview` — preview infrastructure changes
- `cd infra && pulumi up` — deploy infrastructure changes

## Instructions for Claude

### Code Changes

- Follow existing ESLint and Prettier configurations. Do not disable rules or add overrides without explicit approval.
- Use `const` over `let`, never use `var`. Use strict equality (`===`). Always use curly braces for control flow.
- Use ES module syntax (`import`/`export`), not CommonJS.
- When adding a new sub-app or library, ensure it is covered by the workspace layout in `pnpm-workspace.yaml`.
- When adding TypeScript to a sub-app, extend the root ESLint config and layer on `typescript-eslint`.

### Commits

- All commit messages must follow Conventional Commits format.
- Use a scope matching a workspace package name when the change is specific to one package.

### Documentation

- When making changes that affect the developer experience, tooling, repo structure, or setup process, update the relevant documentation:
  - **README.md** — update if the change affects getting started, available commands, repo structure, or contributor-facing workflows
  - **CLAUDE.md** (this file) — update if the change affects tooling, conventions, project structure, or instructions that guide Claude's behavior
- Do not let documentation drift from reality. If you add, remove, or modify a tool, script, config file, or workflow, update docs in the same change.
