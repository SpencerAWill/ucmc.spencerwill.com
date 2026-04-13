# CLAUDE.md

## Project Overview

This is the software system for the University of Cincinnati Mountaineering Club (UCMC). It is a polyglot pnpm monorepo.

## Repository Structure

- `apps/` — Applications (sub-apps with their own configs)
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
- Named Docker volumes persist: pnpm store, Pulumi config (`~/.pulumi`), GitHub CLI config (`~/.config/gh`), Claude data (`~/.claude`)
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
- **Deploy Worker** (`build-and-deploy.yml`) — manual Cloudflare Worker deploy
- **Lint PR** (`lint-pr.yaml`) — validates PR titles follow conventional commit format
- **Infra CI** (`infra-ci.yml`) — runs ESLint, TypeScript type-checking, and Pulumi preview on PRs that modify `infra/`
- **Infra Deploy** (`infra-deploy.yml`) — deploys infrastructure: auto-deploys dev on merge to main, manual prod deploy via `workflow_dispatch` with GitHub environment approval

### Infrastructure

- **Pulumi** — IaC in `infra/`, TypeScript with the `nodejs` runtime
  - Project config in `infra/Pulumi.yaml`
  - Stack configs in `infra/Pulumi.<stack>.yaml` (secrets are encrypted, safe to commit)
  - Two stacks: `dev` (auto-deployed on merge) and `prod` (manual deploy with approval)
  - State stored in Pulumi Cloud
  - Uses pnpm as the package manager (`runtime.options.packagemanager: pnpm`)
  - CI/CD via `infra-ci.yml` (PR preview) and `infra-deploy.yml` (deploy)

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
