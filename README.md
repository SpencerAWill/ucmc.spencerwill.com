# ucmc.spencerwill.com

The University of Cincinnati Mountaineering Club's software system.

## Repository Structure

This is a polyglot pnpm monorepo with the following workspace layout:

- `apps/` — Applications
- `libs/` — Shared libraries
- `infra/` — Pulumi infrastructure-as-code
- `.wiki/` — GitHub wiki (git submodule, auto-synced)

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/)
- [pnpm](https://pnpm.io/) (v10.33.0+)
- [Pulumi CLI](https://www.pulumi.com/docs/install/) (for infrastructure changes)

### Getting Started

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

Scopes are validated against workspace package names, plus `wiki` for wiki-related changes.

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

### Wiki

The GitHub wiki is included as a git submodule at `.wiki/`. It syncs automatically on pull, checkout, and install. A GitHub Action also keeps it updated.

To push local wiki edits:

```bash
pnpm wiki:push
```

This also happens automatically when you `git push` the main repo (via the pre-push hook).
