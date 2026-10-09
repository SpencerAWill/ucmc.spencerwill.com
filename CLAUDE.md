# CLAUDE.md

## Project

**UCMC** (University of Cincinnati Mountaineering Club) — a pnpm monorepo (pnpm@11.1.2 pinned via corepack, **ESM-only**).

| Path             | What it is                                                                       |
| ---------------- | -------------------------------------------------------------------------------- |
| `apps/ucmc-web/` | TanStack Start + React 19 + Vite 8 + Tailwind v4 + shadcn, on Cloudflare Workers |
| `infra/`         | Pulumi (TypeScript, stacks `dev` and `prod`)                                     |
| `.devcontainer/` | Debian devcontainer: Node 24, Pulumi, gh, Claude Code, Playwright, Mailpit       |

Detailed guidance is scoped to the files it applies to in **`.claude/rules/`** and loads when you open a matching file. Start there rather than asking for a tour: `web-architecture`, `data-and-bindings`, `auth-and-rbac`, `site-settings`, `notifications`, `compliance-and-waivers`, `dates-and-formats`, `testing`, `app-chrome`, `feature-*`, `infra`, `dependencies`, `devcontainer`.

## Commands

- `pnpm install` · `pnpm commit` · `pnpm format` (`format:check`)
- `pnpm verify` — lint + typecheck + knip + test across every package, ~70s. `pnpm {lint,typecheck,knip,test}` run the pieces individually.
- `pnpm --filter ucmc-web {dev,build,test,test:coverage,test:mutation,typecheck,lint,knip,storybook,e2e,e2e:ui}`
- `pnpm --filter ucmc-web {deploy:dev,deploy:prod}`
- `pnpm --filter ucmc-web {db:migrate:local,db:seed:local}` — remote sysadmin seeding is the `seed-admin.yml` GitHub Action, not a script

**Migrations are hand-written, not generated.** `db:generate` exists but does not currently run: the drizzle meta snapshots have been stale since `0059`, so `drizzle-kit generate` diffs against a snapshot eight migrations behind, tries to resolve the gap as a set of table renames, and blocks on an interactive prompt that fails outright without a TTY. Migrations `0060`+ are all hand-written SQL with an explanatory header, and the `meta/_journal.json` entry is added by hand alongside. Follow that pattern; regenerating the snapshots is its own piece of work.

- `cd infra && pulumi {preview,up}`

**`knip` must stay green.** It reports unused files, exports, exported types and dependencies — the module-graph findings ESLint can't see, and the thing that will tell us a migration shim (`permission-aliases.ts`, `LEGACY_SETTING_KEYS`, `LEGACY_HERO_SETTING_KEYS`) has lost its last call site. Most entry points here are reached by convention, not by an import, so **a new route, story, script or vitest pool may need a `knip.config.ts` entry.** Every suppression in that file is commented with why; add findings to it only after establishing they're false positives, and prefer `entry` over `ignore` for vendored catalogs so knip still follows their imports.

**Never lint with a bare `eslint .` from the repo root.** The web ESLint config resolves `import/no-restricted-paths` zones against `process.cwd()`; from the root those zones match nothing, and the rule **fails open** — silently passing rather than erroring. Use `pnpm --filter ucmc-web lint`, the way CI does, or the root `pnpm lint`, which is `pnpm -r lint` and therefore runs each package's own script with the cwd set to that package. The root aggregates all work this way; `format` is the one exception, because Prettier's config and `.prettierignore` are repo-wide. **package.json cannot carry a comment, so this is the only place that constraint is written down — don't 'simplify' a root script to a direct tool invocation.**

## Code style

- `const`, never `let`/`var`. Strict equality. Always brace control flow. ESM only.
- Follow the existing ESLint + Prettier config; **don't disable rules without approval.**
- TypeScript is `strict: true`. The path alias `#/*` → `apps/ucmc-web/src/*` (mirrored in `package.json` `imports`).

## Commits & PRs

- **Conventional Commits**, enforced by commitlint (Husky `commit-msg`). Scopes are validated against pnpm workspace names plus `devcontainer`; use `global` for repo-wide changes. `pnpm commit` walks you through it.
- Husky `pre-commit` runs lint-staged, then `typecheck` for each package whose TypeScript changed (`apps/ucmc-web`, `infra`). Typecheck can't live inside lint-staged: `tsc` given explicit filenames ignores `tsconfig.json` entirely, so it has to run once per project, and lint-staged runs different globs concurrently — it would read files the formatters are still rewriting.
- **Split multi-part work into sequenced commits that are each green and independently revertable.** Stage deliberately — `git add -A` sweeps up unrelated work in progress.
- CI: `ci.yml` per-PR (paths-filtered), `deploy.yml` on push to main (dev auto, prod via `workflow_dispatch` + approval), `quality.yml` weekly. **Third-party actions are pinned to commit SHAs, and `${{ }}` never appears inside a `run:` body** — `workflow-lint` runs `actionlint` + `zizmor` and will fail on either. See `.claude/rules/infra.md`. **`quality.yml` is for reports, not gates** — coverage and anything else too slow to justify per-PR. Putting an advisory check in `ci.yml` is how a report becomes a merge blocker nobody chose.

## Always-on invariants

These bite anywhere in the repo, so they live here rather than in a scoped rule.

- **Never read `env.DB` / `env.KV` / `env.BUCKET_*` at module scope.** Go through `getDb()` / `getKv()` / `getPrivateBucket()` / `getPublicBucket()` — `cloudflare:workers` is stubbed for non-SSR bundles, so module-scope access breaks the client build.
- **`Temporal` is the timestamp type everywhere** (via `temporal-polyfill`). There is no `date-fns`; raw `Date` survives only at hard external boundaries. Calendar reasoning runs in `CLUB_TIME_ZONE` (`America/New_York`), never UTC and never the runtime default — the worker runs UTC and the browser runs the viewer's zone, so reading a calendar field off a raw instant is also a hydration-mismatch source.
- **Never compute the club year ad-hoc** — import `currentSeason()` from `src/config/club-season.ts`. It reads as waiver-specific but it is just "which club year is this instant in", and `/volunteer` uses it too.
- **Server-only boundary**: business logic lives in `*-actions.server.ts`; `createServerFn` shells hold one-line handlers that dynamic-import their action. Routes and components import only from shells. Tests call the actions directly.
- **Inline `useMutation` in routes/components is forbidden** — every mutation has a `use-*.ts` hook with a fixed cache-invalidation contract.
- **Features must not import each other.** `import/no-restricted-paths` enforces it; code three features need gets hoisted to `src/server/` or `src/components/`, not published as a third `FEATURE_PUBLIC_API`.
- **Client-side permission gates read `hasPermission` / `hasAnyPermission`** (or `effectivePermissionsFor` on the server), **never `principal.permissions.includes()` and never the mere presence of a field in a server payload.** Both bypass role emulation silently — the server answers the _real_ principal by design.
- **Permissions are DB rows; adding one needs a migration.** Site settings are not — a new entry in the Zod registry is the whole change.
- **Profile prompts, disciplines and badges are not DB rows either** — each is an entry in a registry under `src/server/member-profile/`. Only a member's _answers_ are rows, and they are sparse. **Badges are computed on every read**, never stored, so an award and the evidence for it cannot disagree; a badge marked `blockedBy` has no data source yet and is never awarded. See `.claude/rules/feature-member-profile.md`.
- **Notification categories are not DB rows either** — a new entry in `src/server/notifications/notification-registry.ts` is the whole change. `user_notification_preferences` is sparse: a row exists only when a member moves a category off its registry default. Whether a category can be switched off at all is the registry's `suppressible` field, not a branch in the senders.
- **Wire the sidebar (`app-layout.tsx`) in the same change as any new public route**, and gate the entry on the flag of the page the link actually targets. This has been caught in review repeatedly.
- **`events` is a base table, not the calendar's table.** It lives in `src/server/events/` because `features/trips` (and later `volunteer`) will own satellite tables keyed on `event_id`; kind-specific columns go there, never on `events`. The calendar and both `.ics` feeds read only the base table. See `.claude/rules/feature-calendar.md`.
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
