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
- **Env**: `@t3-oss/env-core` + zod (`apps/web/src/env.ts`) for client (`VITE_*`) vars. Server/Worker vars (APP_BASE_URL, WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME, RESEND_FROM, RESEND_FROM_NAME, RESEND_API_KEY, SESSION_SECRET) are not in t3-env — they reach request handlers via the Worker `env` binding (`apps/web/src/server/cloudflare-env.ts`). Local dev loads them from `apps/web/.env.local` (copy `.env.example`, gitignored) through wrangler v4's standard `.env` precedence (`.env.<mode>.local` > `.env.local` > `.env.<mode>` > `.env`); `.dev.vars` is no longer used. The devcontainer sets `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` in `docker-compose.yml`, so host-exported env vars (e.g. `SESSION_SECRET`, `RESEND_API_KEY` from the developer's shell) win over `.env.local`. Deployed envs get these same vars from Pulumi (`--var` flags) and GitHub secrets (`wrangler secret put`) via `web-deploy.yml`.
- **Database**: Cloudflare D1 (SQLite) via Drizzle ORM. Schema in `apps/web/drizzle/schema.ts`, generated migrations in `apps/web/drizzle/migrations/` (committed). Runtime wrapper at `apps/web/src/server/db/index.ts` exposes a lazy `getDb()` singleton. Worker bindings accessed via `apps/web/src/server/cloudflare-env.ts` (typed wrapper around `cloudflare:workers` `env`). A small Vite plugin in `vite.config.ts` stubs the synthetic `cloudflare:workers` module for non-SSR bundles; never import the `cloudflare-env`/`db` modules outside server functions.
- **Object storage**: Cloudflare R2 via the `BUCKET` binding. Runtime wrapper at `apps/web/src/server/r2/index.ts` exposes `getBucket()`. Unlike D1, R2 bindings are **name-based** (no generated UUID), so `wrangler.jsonc` has the real bucket name and the web-deploy workflow needs no injection step. Local dev uses Miniflare's on-disk R2 simulation under `apps/web/.wrangler/state/v3/r2/` — no separate CLI, `.env.local` entry, or seeding needed. Same "function-wrapped access" invariant as D1: never read `env.BUCKET` at module scope.
- **Key-value store**: Cloudflare Workers KV via the `KV` binding. Runtime wrapper at `apps/web/src/server/kv/index.ts` exposes `getKv()`. Like D1, KV is **UUID-based** — `wrangler.jsonc` holds placeholder UUIDs (`22222222-...` for dev, `33333333-...` for prod) that the web-deploy workflow rewrites from the Pulumi `kvNamespaceId` stack output before build. Miniflare simulates KV under `apps/web/.wrangler/state/v3/kv/` — no seeding needed. Same "function-wrapped access" invariant. The `/health` route probes D1, R2, and KV in parallel.
- **Rate limiting**: the `/health` endpoint is protected by a native Cloudflare Rate Limiting binding (`HEALTH_RATE_LIMITER`), 20 requests / 60 s per `CF-Connecting-IP`. Helper at `apps/web/src/server/rate-limit/index.ts` wraps the binding; it fails _open_ on binding errors so a broken rate limiter never takes the health page down. Config lives under `unsafe.bindings` in `wrangler.jsonc` — the Rate Limiting runtime is GA, but wrangler hasn't graduated this binding to a top-level key yet (same lifecycle D1/R2/KV went through). Dev and prod use different `namespace_id`s so counters are isolated. Miniflare simulates the binding in-memory for local dev.
- **Testing**: Vitest with jsdom and Testing Library
- **Component dev**: Storybook 10 (`pnpm --filter ucmc-web storybook`)
- **Deployment**: Cloudflare Workers via Wrangler (`apps/web/wrangler.jsonc`). Top-level config is the dev binding (so `@cloudflare/vite-plugin` picks it up in local dev); `env.production` overrides for prod. Two workers: `ucmc-web-dev` at `dev.ucmc.spencerwill.com` and `ucmc-web` at `ucmc.spencerwill.com`. Custom domain bindings, D1 databases, R2 buckets, and KV namespaces are provisioned by Pulumi. D1 `database_id` and KV `kv_namespaces[].id` values in `wrangler.jsonc` are placeholders; the web-deploy workflow fetches the real UUIDs from `pulumi stack output d1DatabaseId` / `kvNamespaceId` and rewrites the file before migrations/deploy.
- **Migration workflow**: edit `drizzle/schema.ts` → `pnpm --filter ucmc-web db:generate` → commit the resulting SQL → CI applies it via `wrangler d1 migrations apply --remote` on each deploy. Local dev uses `pnpm --filter ucmc-web db:migrate:local` to apply migrations to the Miniflare-backed SQLite under `apps/web/.wrangler/state/`.
- **TS config**: extends bundler resolution with `strict: true`, path alias `#/*` → `./src/*` (also mirrored in `package.json` `imports` for Node-native resolution), includes `@cloudflare/workers-types` so `D1Database`/`KVNamespace`/etc. are globally typed
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
  - **Cloudflare provider** (`@pulumi/cloudflare`) — manages the Worker custom domain bindings (`dev.ucmc.spencerwill.com`, `ucmc.spencerwill.com`), the D1 databases (`ucmc-web-dev`, `ucmc-web`), the R2 buckets (`ucmc-web-dev-storage`, `ucmc-web-storage`), the KV namespaces (`ucmc-web-dev-kv`, `ucmc-web-kv`), and the DNS records that verify the Resend sending domain (SPF TXT, DKIM, MX return-path). D1, R2, and KV resources are all marked `protect: true` because replacement wipes all data. The `spencerwill.com` zone itself is NOT managed by Pulumi; only the Worker domain records + Resend DNS records within it are. Cloudflare auth in CI uses `CLOUDFLARE_API_TOKEN` (env var picked up by the provider). The D1 database UUID and KV namespace UUID are exported as the `d1DatabaseId` and `kvNamespaceId` stack outputs and consumed by `web-deploy.yml`. The R2 bucket name is exported as `r2BucketNameOutput` for drift detection but is not consumed by any workflow (wrangler binds by name directly).
  - **Resend domain + sending key** (`infra/resend.ts`) — the custom `ResendDomain` component provisions the Resend sending domain, the Cloudflare DNS records Resend requires (MX return-path, SPF TXT, DKIM), triggers verification, and issues a sending-scoped API key. Implementation uses `@pulumi/command` `local.Command` resources that shell out to `infra/scripts/resend.mjs` (Resend has no Pulumi/Terraform provider, and Pulumi's dynamic providers are incompatible with pnpm — [pulumi/pulumi#9085](https://github.com/pulumi/pulumi/issues/9085)). The script calls the Resend REST API; Pulumi's Cloudflare provider manages the DNS records as first-class resources. **Prerequisite**: a management API key (full*access) must be created manually in the Resend dashboard and stored as a GitHub environment secret (`RESEND_MANAGEMENT_API_KEY`) on both the `dev` and `prod` environments (same pattern as `CLOUDFLARE_API_TOKEN`). For local `pulumi up`, export it in your shell: `export RESEND_MANAGEMENT_API_KEY=re*...`. The sending key is exported as the `resendApiKey`stack output (Pulumi secret) and consumed by`web-deploy.yml`as the Worker's`RESEND_API_KEY`— the GitHub`RESEND_API_KEY`environment secret is no longer used. Component is`protect: true`; destroying it re-issues DKIM keys and invalidates the sending token.

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
- `pnpm --filter ucmc-web db:generate` — generate Drizzle SQL migrations from `drizzle/schema.ts`
- `pnpm --filter ucmc-web db:migrate:local` — apply migrations to the local Miniflare D1 (SQLite under `apps/web/.wrangler/state/`)
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
