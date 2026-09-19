---
name: add-feature-module
description: Scaffold a new feature under apps/ucmc-web/src/features/ with its import boundaries, route, page flag, and sidebar entry wired. Use when adding a new feature area or a new public page to the web app.
---

# Add a feature module

Bulletproof React layout, enforced by `import/no-restricted-paths`. Background is in `.claude/rules/web-architecture.md`.

## 1. Create the directory

```
src/features/<name>/
├── components/
├── api/            # query-keys.ts, queries.ts (*QueryOptions factories), use-*.ts per mutation
└── server/         # *-actions.server.ts, repos, *-fns.ts shells, __tests__/
```

Omit `api/` and `server/` if there is genuinely nothing to store — `features/trips/` has only `components/`. **Still create the feature as a real entry** so the fences are in place when it grows.

## 2. Add it to the ESLint `FEATURES` array

One entry in `apps/ucmc-web/eslint.config.js`. The pairwise cross-feature zones are generated from that array — **this is the whole boundary change.** Skipping it means the rule never applies to your feature, silently; five features had drifted this way before the zones were generated.

Do **not** add a `FEATURE_PUBLIC_API` entry. Only `auth` and `settings` have one, both foundational. **A third is a signal to hoist that surface out of `src/features/` instead** — into `src/server/`, `src/hooks/`, or `src/components/`.

## 3. Respect the layers

- **Server-only boundary**: business logic in `*-actions.server.ts`; `createServerFn` shells hold one-line handlers that `await import()` their action. Routes and components import only from shells. Tests call actions directly.
- **No inline `useMutation`** — every mutation gets a `use-*.ts` hook with a fixed cache-invalidation contract; call sites pass `onSuccess` / `onError` to `mutate()`.
- Never read `env.*` at module scope — use `getDb()` / `getKv()` / `getPrivateBucket()` / `getPublicBucket()`.
- Free-text search goes through `likeContains()`, not a hand-rolled needle.

## 4. Add the route

Routes are flat files in `src/routes/` (`feature.tsx`, `feature.$publicId.tsx`, `feature._tabs.child.tsx`).

**Wrap the page body in `PageContainer`** (`#/components/layouts/page-container`) with the tier that fits — `prose` for copy, `app` for a single-column signed-in page, `wide` for a table. Never hand-roll `mx-auto max-w-* p-*`, and never render your own `<main>`; the shell owns the landmark. A `PageHero` renders as a sibling above the container, not inside it. See the `app-chrome` rule.

**After adding or renaming a route, run `pnpm --filter ucmc-web build` (or `dev`) and commit the regenerated `src/routeTree.gen.ts`.** Never hand-edit it — a `.claude/` hook and permission rules block that, and a hand-edit that disagrees with the route files makes `tsc` pass against a tree the router doesn't serve.

## 5. Add the page flag and the sidebar entry

Both, in the same change. See the `add-page-flag` skill for the guard wiring.

**Wiring the sidebar is the step that gets missed** — a route with no nav entry is invisible, and this has been caught in review repeatedly. Gate the entry on `permission && flags.pages.<key>`, using the flag of the page the link actually targets.

## 6. Permissions

If the feature needs its own permission, that is a **DB row and therefore a migration** (unlike settings). Seed it ungranted if it should be delegable at `/access`.

Consider whether a permission is warranted at all: `/trips` deliberately has none, because it's a stopgap that gets deleted and a migration isn't worth spending on it.

If a write permission should imply a read one, express the OR in **one shared helper** (`requireGearInspector`-style) and grant the read permission explicitly in the seed migration — there is no implication mechanism, and `/access` should show the real grant.

## 7. Verify

```bash
pnpm --filter ucmc-web lint       # NOT from the repo root — zones fail open there
pnpm --filter ucmc-web typecheck
pnpm --filter ucmc-web test
```

Then update `README.md`, `CLAUDE.md` if an always-on invariant changed, and add or extend the matching `.claude/rules/` file.
