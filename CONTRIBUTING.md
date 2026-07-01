# Contributing

Thanks for your interest in contributing to UCMC's software. This document covers the conventions and workflows specific to this repository. By participating you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

If you found a security issue, please **do not** open a public issue — see [SECURITY.md](./SECURITY.md).

## Getting started

The fastest path is the included dev container — it provisions Node 22, pnpm, Pulumi, gh, Claude Code, and Playwright in one step. See the [README](./README.md#dev-container-recommended) for VS Code / Codespaces instructions.

Manual setup:

```bash
git clone --recurse-submodules <repo-url>
cd ucmc.spencerwill.com
pnpm install            # installs deps and registers husky hooks
```

Then copy `apps/ucmc-web/.env.example` to `apps/ucmc-web/.env.local` and fill in the values (see the README's [Local env section](./README.md#local-env-envlocal)).

Common workspace commands (all run from the repo root):

```bash
pnpm --filter ucmc-web dev          # http://localhost:3000
pnpm --filter ucmc-web test         # vitest (workers + dom pools)
pnpm --filter ucmc-web typecheck    # tsc --noEmit
pnpm --filter ucmc-web e2e          # Playwright
pnpm exec eslint .                  # lint the whole monorepo
pnpm exec prettier --write .
```

## Branching and PRs

- Branch from `main`. Keep branches narrowly scoped — one logical change per PR.
- Open the PR against `main`. The PR template will prompt you for context, screenshots (if UI), and a test plan.
- CI must be green before merge: `web-ci.yml` runs lint, typecheck, vitest, and an axe a11y pass; `infra-ci.yml` runs `pulumi preview` on dev for any `infra/` change and posts the diff as a comment.
- Squash-merge is preferred. The merge commit subject must itself be a valid Conventional Commit (it lands on `main`).

## Commits

Conventional Commits are enforced by commitlint via the `commit-msg` husky hook. Format:

```
type(scope): description
```

- **Valid types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Valid scopes**: any pnpm workspace name (e.g. `ucmc-web`), plus `wiki` and `devcontainer` for cross-cutting changes. The list is validated against `pnpm-workspace.yaml` at commit time.
- Use the imperative mood in the subject ("add", not "added"/"adds"). Keep it under ~70 characters.

You can use the interactive helper:

```bash
pnpm commit
```

Examples:

- `feat(ucmc-web): add gear barcode label printing`
- `fix(ucmc-web): re-validate waiver cycle on August 15 rollover`
- `chore(devcontainer): pin pnpm to 10.33`

## Code style

- **ESM only.** No CommonJS.
- `const` over `let`/`var`. Strict equality (`===`/`!==`). Always brace control flow.
- TypeScript `strict: true` everywhere. No `any` without a justified comment.
- ESLint + Prettier run on every commit via `lint-staged`. Don't disable rules without approval — if a rule is wrong for a real reason, raise it in the PR.
- Path alias for the web app: `#/*` → `apps/ucmc-web/src/*` (also mirrored in `package.json` `imports`).

## Architectural invariants (web app)

`apps/ucmc-web/CLAUDE.md` and the root [`CLAUDE.md`](./CLAUDE.md) describe the load-bearing patterns. The ones contributors break most often:

- **Bulletproof feature layout.** Features live under `src/features/<name>/` with `components/`, `api/`, `server/`. Features cannot import each other (enforced by `import/no-restricted-paths`); shared code cannot import features.
- **No inline `useMutation` in routes/components.** Every mutation gets a `use-*.ts` hook under the feature's `api/` directory, with its own cache-invalidation contract.
- **Server-only modules** end in `*.server.ts` and must not be imported from the client graph. Server functions follow the three-layer pattern (leaf helper / action / shell). See the "Server-only module boundary" section in `CLAUDE.md`.
- **Cloudflare bindings** (`DB`, `KV`, `BUCKET_*`) are accessed via `getDb()` / `getKv()` / `getPrivateBucket()` / `getPublicBucket()` only — never at module scope.
- **Email normalization.** Every read/write of an email address goes through `apps/ucmc-web/src/server/auth/email-normalize.ts`.
- **Waiver cycle.** Always compute via `currentWaiverCycle()` from `apps/ucmc-web/src/config/waiver-cycle.ts`. Never inline the math.
- **Legal copy** in `apps/ucmc-web/src/config/legal.ts` must match the canonical PDF byte-for-byte. Treat edits to disclaimer/nondiscrimination/anti-hazing/waiver/privacy/terms copy as legal review, not word-smithing. Bumping `WAIVER_VERSION` invalidates every existing attestation.

If your change crosses one of these boundaries, call it out in the PR description.

## Tests

The web app has two Vitest pools:

- **`workers`** — `*.test.ts` runs in real workerd via `@cloudflare/vitest-pool-workers`. D1 migrations are applied once per file; **storage isolation is per file, not per test**, so any test that writes to D1 must clear the relevant tables in `beforeEach`.
- **`dom`** — `*.test.tsx` runs in jsdom + Testing Library + user-event.

E2E lives in `apps/ucmc-web/e2e/` and runs against a freshly-spawned dev server. Currently only `a11y.spec.ts` runs in CI; full suite locally with `pnpm --filter ucmc-web e2e`.

When you fix a bug, add a regression test in the same PR.

## Documentation

- **Update `README.md` and `CLAUDE.md` in the same PR** whenever you change tooling, scripts, workflows, the workspace layout, or any load-bearing invariant. CI does not detect doc drift, so reviewers will.
- Compliance-shaped features: update `.wiki/Compliance.md` to map the new obligation → file/route.
- The wiki (`.wiki/`) is a git submodule, auto-synced on pull/checkout. To push wiki edits: `pnpm wiki:push` (also runs automatically via the pre-push hook).

## Infrastructure changes

Any change under `infra/`:

1. `cd infra && pulumi preview` locally first to read the diff.
2. Flag resource replacements or deletions in the PR description. D1, R2, and KV resources are `protect: true` — replacing them requires removing the protection by hand and is almost always wrong.
3. Dev auto-deploys on merge; prod requires manual dispatch with environment approval. **For Resend specifically, prod must `pulumi up` before dev** (dev reads `resendApiKey` via a `StackReference` to prod).

## Reviewing

When reviewing someone else's PR:

- Check the PR template's test plan against the diff. Reject "n/a" without a reason.
- For UI changes, pull the branch and click through the actual flow — typecheck and Vitest don't catch feature-level regressions.
- For server-fn / auth / compliance changes, verify the invariants in `CLAUDE.md` still hold.

## Questions

Open a discussion or ping the maintainer (`spencer.a.will@gmail.com`). For UCMC club members, the exec board is also a reasonable first stop for anything domain-specific (waivers, member statuses, gear policy).
