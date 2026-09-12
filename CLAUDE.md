# CLAUDE.md

## Project

**UCMC** (University of Cincinnati Mountaineering Club) — a pnpm monorepo (pnpm@11.1.2 pinned via corepack, **ESM-only**).

| Path             | What it is                                                                       |
| ---------------- | -------------------------------------------------------------------------------- |
| `apps/ucmc-web/` | TanStack Start + React 19 + Vite 8 + Tailwind v4 + shadcn, on Cloudflare Workers |
| `infra/`         | Pulumi (TypeScript, stacks `dev` and `prod`)                                     |
| `.devcontainer/` | Debian devcontainer: Node 24, Pulumi, gh, Claude Code, Playwright, Mailpit       |

Detailed guidance is scoped to the files it applies to in **`.claude/rules/`** and loads when you open a matching file. Start there rather than asking for a tour: `web-architecture`, `data-and-bindings`, `auth-and-rbac`, `site-settings`, `compliance-and-waivers`, `dates-and-formats`, `testing`, `app-chrome`, `feature-*`, `infra`, `dependencies`, `devcontainer`.

## Commands

- `pnpm install` · `pnpm commit` · `pnpm exec eslint .` · `pnpm exec prettier --write .`
- `pnpm --filter ucmc-web {dev,build,test,typecheck,lint,storybook,e2e,e2e:ui}`
- `pnpm --filter ucmc-web {deploy:dev,deploy:prod}`
- `pnpm --filter ucmc-web {db:generate,db:migrate:local,db:seed:local}` — remote sysadmin seeding is the `seed-admin.yml` GitHub Action, not a script
- `cd infra && pulumi {preview,up}`

**Run lint as `pnpm --filter ucmc-web lint`, the way CI does.** The web ESLint config resolves `import/no-restricted-paths` zones against `process.cwd()`; from the repo root those zones match nothing, and the rule **fails open** — silently passing rather than erroring.

## Code style

- `const`, never `let`/`var`. Strict equality. Always brace control flow. ESM only.
- Follow the existing ESLint + Prettier config; **don't disable rules without approval.**
- TypeScript is `strict: true`. The path alias `#/*` → `apps/ucmc-web/src/*` (mirrored in `package.json` `imports`).

## Commits & PRs

- **Conventional Commits**, enforced by commitlint (Husky `commit-msg`). Scopes are validated against pnpm workspace names plus `devcontainer`; use `global` for repo-wide changes. `pnpm commit` walks you through it.
- Husky `pre-commit` runs lint-staged.
- **Split multi-part work into sequenced commits that are each green and independently revertable.** Stage deliberately — `git add -A` sweeps up unrelated work in progress.
- CI: `ci.yml` per-PR (paths-filtered), `deploy.yml` on push to main (dev auto, prod via `workflow_dispatch` + approval).

## Always-on invariants

These bite anywhere in the repo, so they live here rather than in a scoped rule.

- **Never read `env.DB` / `env.KV` / `env.BUCKET_*` at module scope.** Go through `getDb()` / `getKv()` / `getPrivateBucket()` / `getPublicBucket()` — `cloudflare:workers` is stubbed for non-SSR bundles, so module-scope access breaks the client build.
- **`Temporal` is the timestamp type everywhere** (via `temporal-polyfill`). There is no `date-fns`; raw `Date` survives only at hard external boundaries. Calendar reasoning runs in `CLUB_TIME_ZONE` (`America/New_York`), never UTC and never the runtime default — the worker runs UTC and the browser runs the viewer's zone, so reading a calendar field off a raw instant is also a hydration-mismatch source.
- **Never compute the club year ad-hoc** — import `currentWaiverCycle()` from `src/config/waiver-cycle.ts`. It reads as waiver-specific but it is just "which club year is this instant in", and `/volunteer` uses it too.
- **Server-only boundary**: business logic lives in `*-actions.server.ts`; `createServerFn` shells hold one-line handlers that dynamic-import their action. Routes and components import only from shells. Tests call the actions directly.
- **Inline `useMutation` in routes/components is forbidden** — every mutation has a `use-*.ts` hook with a fixed cache-invalidation contract.
- **Features must not import each other.** `import/no-restricted-paths` enforces it; code three features need gets hoisted to `src/server/` or `src/components/`, not published as a third `FEATURE_PUBLIC_API`.
- **Client-side permission gates read `hasPermission` / `hasAnyPermission`** (or `effectivePermissionsFor` on the server), **never `principal.permissions.includes()` and never the mere presence of a field in a server payload.** Both bypass role emulation silently — the server answers the _real_ principal by design.
- **Permissions are DB rows; adding one needs a migration.** Site settings are not — a new entry in the Zod registry is the whole change.
- **Wire the sidebar (`app-layout.tsx`) in the same change as any new public route**, and gate the entry on the flag of the page the link actually targets. This has been caught in review repeatedly.
- **Legal and policy copy is legal review, not word-smithing** — `src/config/legal.ts` and the pages it feeds must match the canonical PDF byte-for-byte. Raise copy changes rather than tidying them.

## Generated files

**`apps/ucmc-web/src/routeTree.gen.ts` is generated — never hand-edit it.** `@tanstack/router-plugin` writes it during `vite dev` / `vite build`, and it **is committed** (typecheck and CI read it), which is exactly what makes it look editable. A hand-edit is clobbered by the next build; a hand-edit that _disagrees_ with the route files is worse, because `tsc` then passes against a tree the router doesn't actually serve. **Adding or renaming a route means running `pnpm --filter ucmc-web build` (or `dev`) and committing what it writes.**

Two guards enforce this, both under `.claude/`: `permissions.deny` rules in `settings.json` block the Edit and Write tools, and the `PreToolUse` hook `hooks/block-generated-file-edits.sh` additionally catches shell writes (redirects, in-place editors, `tee`) that permission rules can't see. **Reads stay allowed on purpose** — `git diff --exit-code` on the file is how `pr-preflight` checks it's in sync.

The hook **inspects each command segment's head, not the whole command string**, and that distinction is load-bearing: the first cut scanned the string and denied a heredoc that merely _documented_ an in-place edit, which blocked the commit documenting it. `hooks/block-generated-file-edits.test.sh` pins both directions — run it after touching the hook.

## Keeping docs honest

- **Update `README.md` and this file in the same change** when tooling, scripts, workflows, or repo structure change. No drift.
- When a change contradicts a `.claude/rules/` file, update that rule in the same commit. A rule that describes code which no longer exists is worse than no rule.
- The [compliance wiki](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki/Compliance) is edited on GitHub and is **not** checked out here — update it when adding compliance-shaped features.

## Where things live

| Kind of knowledge                                  | Goes in                            |
| -------------------------------------------------- | ---------------------------------- |
| Always true, everywhere                            | this file                          |
| Only matters for one area of the codebase          | `.claude/rules/*.md` (`paths:`)    |
| A multi-step procedure you'd otherwise re-explain  | `.claude/skills/*/SKILL.md`        |
| A focused review or check with its own tool budget | `.claude/agents/*.md`              |
| Must happen regardless of what Claude decides      | `.claude/hooks/` + `settings.json` |
