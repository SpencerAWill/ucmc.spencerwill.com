# CLAUDE.md

## Project

**UCMC** (University of Cincinnati Mountaineering Club) — a pnpm monorepo (pnpm@11.1.2 pinned via corepack, **ESM-only**).

| Path             | What it is                                                                             |
| ---------------- | -------------------------------------------------------------------------------------- |
| `apps/ucmc-web/` | TanStack Start + React 19 + Vite 8 + Tailwind v4 + shadcn, on Cloudflare Workers       |
| `infra/`         | Pulumi: `cloudflare/` (stacks `dev`, `prod`) and `github/` (stack `main`, run locally) |
| `docs/adr/`      | Architecture decision records                                                          |
| `.devcontainer/` | Debian devcontainer: Node 24, Pulumi, gh, Claude Code, Playwright, gitleaks, Mailpit   |

Detailed guidance is scoped to the files it applies to in **`.claude/rules/`** and loads when you open a matching file. Start there rather than asking for a tour: `web-architecture`, `data/*`, `auth/*`, `site-settings`, `notifications`, `compliance-and-waivers`, `dates-and-formats`, `testing`, `app-chrome`, `feedback-index`, `feature-*`, `gear/*`, `infra`, `dependencies`, `devcontainer`. **Keep each rule's `paths` as narrow as the guidance it carries**: a matching read loads the whole file and it stays in context for the session, so a rule that grows past one area is split by area (as `gear/` is) rather than widened.

## Commands

- `pnpm install` · `pnpm commit` · `pnpm format` (`format:check`)
- `pnpm verify` — lint + typecheck + knip + migration drift + test across every package, ~70s. `pnpm {lint,typecheck,knip,db:drift,test}` run the pieces individually.
- `pnpm --filter ucmc-web {dev,build,test,test:coverage,test:mutation,typecheck,lint,knip,storybook,e2e,e2e:ui}`
- `pnpm --filter ucmc-web {deploy:dev,deploy:prod}`
- `pnpm --filter ucmc-web sync-env --stack <dev|prod> --outputs <pulumi stack output --json file> [--dry-run]` — points `wrangler.jsonc` at a stack; CI runs it before every deploy build. **A new binding must be taught to `scripts/wrangler-env.ts`** or it refuses the file.
- `pnpm --filter ucmc-web {db:generate,db:drift,db:migrate:local,db:seed:local}` — remote sysadmin seeding is the `seed-admin.yml` GitHub Action, not a script

**Every migration goes through `drizzle-kit generate`, even a hand-written one** (#318). Edit `drizzle/schema.ts`, then `pnpm --filter ucmc-web db:generate --name <what_it_does>`, or `db:generate --custom --name <what_it_does>` for an empty file to write SQL into (backfills, triggers, FTS, anything Drizzle can't express). Either way generate writes the `_journal.json` entry **and** a snapshot of `schema.ts`, which is the chain the next `generate` diffs against. **Never write a migration file or a journal entry by hand**: that is how the snapshots stopped at `0059` while the migrations ran on, and `0060`–`0083` exist only as hand-written SQL (`0084_snapshot.json` restarted the chain). `db:drift` runs in `pnpm verify` and CI and fails when `schema.ts` and the newest snapshot disagree. Review generated DDL like hand-written: it must only add, and a table rebuild is the trap in `data/migrations.md`.

- `cd infra/cloudflare && pulumi {preview,up}`; `infra/github` is applied locally by an admin (`pnpm --filter @ucmc/infra-github {preview,apply}`)

**`knip` must stay green.** It reports unused files, exports, exported types and dependencies — the module-graph findings ESLint can't see, and the thing that will tell us a migration shim (`permission-aliases.ts`, `LEGACY_SETTING_KEYS`, `LEGACY_HERO_SETTING_KEYS`) has lost its last call site. Most entry points here are reached by convention, not by an import, so **a new route, story, script or vitest pool may need a `knip.config.ts` entry.** Every suppression in that file is commented with why; add findings to it only after establishing they're false positives, and prefer `entry` over `ignore` for vendored catalogs so knip still follows their imports.

**Never lint with a bare `eslint .` from the repo root.** The web ESLint config resolves `import/no-restricted-paths` zones against `process.cwd()`; from the root those zones match nothing, and the rule **fails open** — silently passing rather than erroring. Use `pnpm --filter ucmc-web lint`, the way CI does, or the root `pnpm lint`, which is `pnpm -r lint` and therefore runs each package's own script with the cwd set to that package. The root aggregates all work this way; `format` is the one exception, because Prettier's config and `.prettierignore` are repo-wide. **package.json cannot carry a comment, so this is the only place that constraint is written down — don't 'simplify' a root script to a direct tool invocation.**

## Code style

- `const`, never `let`/`var`. Strict equality. Always brace control flow. ESM only.
- Follow the existing ESLint + Prettier config; **don't disable rules without approval.**
- TypeScript is `strict: true`. The path alias `#/*` → `apps/ucmc-web/src/*` (mirrored in `package.json` `imports`).

## Commits & PRs

- **Conventional Commits**, enforced by commitlint (Husky `commit-msg`). Scopes are validated against pnpm workspace names plus `devcontainer`; use `global` for repo-wide changes. `pnpm commit` walks you through it.
- Husky `pre-commit` refuses a commit deleting more than 20 files, checked first and again last (a truncated index; recover with `git reset`, override with `ALLOW_MASS_DELETE=1`) and runs a gitleaks scan of the staged changes (skipped with a warning where gitleaks isn't installed; CI's `secrets` job is the gate). Then it runs lint-staged, then `typecheck` for each package whose TypeScript changed (`apps/ucmc-web`, `infra/cloudflare`, `infra/github`). Typecheck can't live inside lint-staged: `tsc` given explicit filenames ignores `tsconfig.json` entirely, so it has to run once per project, and lint-staged runs different globs concurrently — it would read files the formatters are still rewriting.
- **Split multi-part work into sequenced commits that are each green and independently revertable.** Stage deliberately — `git add -A` sweeps up unrelated work in progress.
- CI/CD: **`cicd.yml` is one pipeline** (ADR 0002): checks on every PR (paths-filtered) and on every push to main (unfiltered), then on main `Deploy — dev` and `Deploy — prod` in the same run, prod behind the `prod` environment's reviewer. The `main` ruleset requires a PR and the aggregate `required` job, so **a new check job goes in `required`'s `needs:`**. Both deploys run `.github/actions/deploy`; **prod migrates later than dev in the same run and rollback is code-only, so migrations must only add.** `quality.yml` weekly. **Third-party actions are pinned to commit SHAs, and `${{ }}` never appears inside a `run:` body** — `workflow-lint` runs `actionlint` + `zizmor` and will fail on either. See `.claude/rules/infra.md`. **`quality.yml` is for reports, not gates** — coverage and anything else too slow to justify per-PR. Putting an advisory check in `cicd.yml` is how a report becomes a merge blocker nobody chose.

## Always-on invariants

These bite anywhere in the repo, so they live here rather than in a scoped rule.

- **Never read `env.DB` / `env.KV` / `env.BUCKET_*` at module scope.** Go through `getDb()` / `getKv()` / `getPrivateBucket()` / `getPublicBucket()` — `cloudflare:workers` is stubbed for non-SSR bundles, so module-scope access breaks the client build.
- **No D1 statement may bind a number of parameters that grows with the data** — D1 refuses past 100. A list from the caller is `inJsonArray` (one JSON parameter), a list the database already holds is `inSubquery`, and a multi-row write is `insertStatements` / `insertMany` (split to fit, one atomic batch). ESLint bans Drizzle's `inArray` / `notInArray`. See `data/core.md` and #291.
- **`Temporal` is the timestamp type everywhere** (via `temporal-polyfill`). There is no `date-fns`; raw `Date` survives only at hard external boundaries. Calendar reasoning runs in `CLUB_TIME_ZONE` (`America/New_York`), never UTC and never the runtime default — the worker runs UTC and the browser runs the viewer's zone, so reading a calendar field off a raw instant is also a hydration-mismatch source.
- **Never compute the club year ad-hoc** — import `currentSeason()` from `src/config/club-season.ts`. The season runs **Aug 1 → Jul 31** Cincinnati-local, labelled `"YYYY-YY"`, and **the waiver term is the season**: `/volunteer`, member tenure and the waiver guard all read the one helper rather than each re-deriving an August boundary.
- **Server-only boundary**: business logic lives in `*-actions.server.ts`; `createServerFn` shells hold one-line handlers that dynamic-import their action. Routes and components import only from shells. Tests call the actions directly.
- **Inline `useMutation` in routes/components is forbidden** — every mutation has a `use-*.ts` hook with a fixed cache-invalidation contract.
- **Features must not import each other.** `import/no-restricted-paths` enforces it; code three features need gets hoisted to `src/server/` or `src/components/`, not published as a third `FEATURE_PUBLIC_API`.
- **Client-side permission gates read `hasPermission` / `hasAnyPermission`** (or `effectivePermissionsFor` on the server), **never `principal.permissions.includes()` and never the mere presence of a field in a server payload.** Both bypass role emulation silently — the server answers the _real_ principal by design.
- **Permissions are DB rows; adding one needs a migration.** Site settings are not — a new entry in the Zod registry is the whole change. **Only permissions marked `anonymous_grantable` may go on the `anonymous` role**, and every signed-in viewer inherits that role's grants; see `auth/emulation.md`.
- **Profile prompts, disciplines and badges are not DB rows either** — each is an entry in a registry under `src/server/member-profile/`. Only a member's _answers_ are rows, and they are sparse. **Badges are computed on every read**, never stored, so an award and the evidence for it cannot disagree; a badge marked `blockedBy` has no data source yet and is never awarded. See `.claude/rules/feature-member-profile.md`.
- **Notification categories are not DB rows either** — a new entry in `src/server/notifications/notification-registry.ts` is the whole change. `user_notification_preferences` is sparse: a row exists only when a member moves a category off its registry default. Whether a category can be switched off at all is the registry's `suppressible` field, not a branch in the senders.
- **Wire the sidebar (`app-layout.tsx`) in the same change as any new public route**, and gate the entry on the flag of the page the link actually targets. This has been caught in review repeatedly.
- **`events` is a base table, not the calendar's table.** It lives in `src/server/events/` because `features/trips` (and later `volunteer`) will own satellite tables keyed on `event_id`; kind-specific columns go there, never on `events`. The calendar and both `.ics` feeds read only the base table. See `.claude/rules/feature-calendar.md`.
- **Charts mount through `ChartSurface`, never `<Chart>` directly** (`features/analytics`). It carries the `--chart-*` → `--ts-chart-*` palette bridge, the required `ariaLabel`, the SSR sizing that keeps the full SVG in the HTML response, and the exact-value table three of our six categorical slots oblige. `--chart-*` is **identity** and `--chart-ramp-*` is **magnitude**; using one for the other's job is the most common chart-colour mistake and `styles.css` explains both.
- **Legal and policy copy is legal review, not word-smithing** — `src/config/legal.ts` and the pages it feeds must match the canonical PDF byte-for-byte. Raise copy changes rather than tidying them.

## Generated files

**`apps/ucmc-web/src/routeTree.gen.ts` is generated — never hand-edit it.** `@tanstack/router-plugin` writes it during `vite dev` / `vite build`, and it **is committed** (typecheck and CI read it), which is exactly what makes it look editable. A hand-edit is clobbered by the next build; a hand-edit that _disagrees_ with the route files is worse, because `tsc` then passes against a tree the router doesn't actually serve. **Adding or renaming a route means running `pnpm --filter ucmc-web build` (or `dev`) and committing what it writes.**

Two guards enforce this, both under `.claude/`: `permissions.deny` rules in `settings.json` block the Edit and Write tools, and the `PreToolUse` hook `hooks/block-generated-file-edits.sh` additionally catches shell writes (redirects, in-place editors, `tee`) that permission rules can't see. **Reads stay allowed on purpose** — `git diff --exit-code` on the file is how `pr-preflight` checks it's in sync.

The hook **inspects each command segment's head, not the whole command string**, and that distinction is load-bearing: the first cut scanned the string and denied a heredoc that merely _documented_ an in-place edit, which blocked the commit documenting it. `hooks/block-generated-file-edits.test.sh` pins both directions — run it after touching the hook.

## Verification before stopping

A `Stop` hook, `hooks/verify-on-stop.sh`, runs ESLint on the code files changed since `HEAD` and `tsc --noEmit` for each package they belong to (deletions and `tsconfig` edits count, as in pre-commit), and **blocks the end of a turn with the errors when either fails**. It runs nothing when no code changed or when the code is unchanged since the last check that passed, so it costs roughly 10s per turn that touched code. After a block, a stop **with the code unchanged** goes through, which is how to leave a check failing on purpose (say why, then stop). A stop after **changing** the code is a fix attempt and is checked again. It blocks at most 3 times in a row; after that the turn ends with a warning that the checks are still red. `CLAUDE_SKIP_STOP_VERIFY=1` turns it off. It is the floor, not the bar: tests, knip and `db:drift` are still yours to run, and **"done" means quoting the command and its result**, not asserting it. Run the narrowest test that covers the change first (`pnpm --filter ucmc-web exec vitest run <path relative to apps/ucmc-web>`; both pools, under a second for one file), then `pnpm verify` before a PR.

## TypeScript language server

`.claude/settings.json` enables the `typescript-lsp` plugin, which gives Claude go-to-definition, find-references and type errors straight after each edit instead of grep-and-read. It launches `typescript-language-server` from `PATH`. That's `.claude/bin/typescript-language-server`, a wrapper that execs the root devDependency in whichever checkout Claude runs in, against the root `typescript` pinned with the packages' version. The devcontainer links it onto `PATH` itself. **On a host, link it once:** `ln -sfn "$PWD/.claude/bin/typescript-language-server" ~/.local/bin/` from the repo root, with `~/.local/bin` on `PATH`. **Bump the root `typescript` with the packages' pin**, or the server checks against a different compiler than `tsc`.

## Compaction

When compacting, keep the current branch, every file modified so far, the commands that verified them and their results, and any decision the user made in this session.

## Keeping docs honest

- **Update `README.md` and this file in the same change** when tooling, scripts, workflows, or repo structure change. No drift.
- When a change contradicts a `.claude/rules/` file, update that rule in the same commit. A rule that describes code which no longer exists is worse than no rule.
- The [compliance wiki](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki/Compliance) is edited on GitHub and is **not** checked out here — update it when adding compliance-shaped features.

## Where things live

| Kind of knowledge                                   | Goes in                            |
| --------------------------------------------------- | ---------------------------------- |
| Always true, everywhere                             | this file                          |
| Only matters for one area of the codebase           | `.claude/rules/*.md` (`paths:`)    |
| A multi-step procedure you'd otherwise re-explain   | `.claude/skills/*/SKILL.md`        |
| A library's own guidance, version-locked            | a symlink in `.claude/skills/`     |
| A focused review or check with its own tool budget  | `.claude/agents/*.md`              |
| Must happen regardless of what Claude decides       | `.claude/hooks/` + `settings.json` |
| A decision spanning infra, app and workflow at once | `docs/adr/NNNN-*.md`               |
