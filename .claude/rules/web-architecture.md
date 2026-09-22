---
paths:
  - "apps/ucmc-web/src/**"
  - "apps/ucmc-web/eslint.config.js"
---

# Web app architecture (`apps/ucmc-web`)

## Source layout (Bulletproof React)

Features live under `src/features/`. Each has `components/`, `api/` (`query-keys.ts`, `queries.ts` exposing `*QueryOptions()` factories, per-mutation `use-*.ts` hooks), and `server/` (server fns + actions + repos + tests). Run `ls src/features/` for the current set.

Shared/foundational code lives outside features: `src/server/auth/`, `src/server/profile/`, `src/components/` (UI primitives, `profile/`, `layouts/`, `markdown/`, `editor/`), `src/lib/`, `src/hooks/`, `src/config/`. Routes (`src/routes/`) compose features but never the reverse.

`import/no-restricted-paths` (in `eslint.config.js`) enforces the boundaries: features can't import each other, shared code can't import features, features can't import routes. Tests are exempt.

**The cross-feature zones are generated, not enumerated** — `FEATURES` lists every directory under `src/features/` and the pairwise zones are built from it, so **adding a feature is one entry in that array**. They used to be 62 hand-written zone objects and had drifted badly: five features had no zones at all, so the rule hadn't applied to anything added after `club-feedback`.

**Zone paths and the resolver's `project` are anchored to the config file via `zonePath()`, and that is load-bearing.** `import/no-restricted-paths` resolves relative paths against `process.cwd()`, so `./src/features/...` and `./tsconfig.json` are correct under `pnpm --filter ucmc-web lint` (how CI runs it) but point at `<repo>/src/...` under a repo-root `pnpm exec eslint .`. A zone that matches nothing — or a specifier the resolver can't resolve — **fails open**: the rule silently passes. Both halves must be absolute; fixing one alone changes nothing, and the failure mode is indistinguishable from clean output.

### Two features publish a `FEATURE_PUBLIC_API`, both foundational

- **auth** (`api/use-auth.ts`, `api/view-mode.tsx`, `guards.ts`) — "who is the user".
- **settings** (`api/queries.ts` — `publicFlagsQueryOptions` / `publicSiteContactQueryOptions`) — "what is the site configured to show". Four features read it, and a nav entry that can't see a page flag renders a link that 404s.

Everything else under those features stays private. Two one-off `ZONE_EXCEPTIONS` remain: `auth <- waivers` (for `requireCurrentWaiver`) and `members <- landing` (for role-update cache invalidation).

**A third `FEATURE_PUBLIC_API` entry is a signal to hoist that surface out of `src/features/` instead** — that's how `use-image-crop` reached `src/hooks/` and the curated icon registry reached `src/components/`. Foundational code that three features need lives in `src/server/` or `src/components/`, not in one feature that the others reach into:

- The audit **recorder** (`recordAuditEvent` etc.) is in `src/server/audit/audit-log.server.ts`; only the read-side viewer lives in `features/audit/`.
- The "current attestation" predicate is in `src/server/waivers/current-attestation.server.ts`.
- Free-text search is `likeContains()` in `src/server/db/index.ts`.

## API layer

**Inline `useMutation` in routes/components is forbidden.** Each mutation has a `use-*.ts` hook with a fixed cache-invalidation contract; call sites pass `onSuccess`/`onError` to `mutate()`.

**A mutation that changes what a detail page renders must invalidate the detail key too, not only the list.** Where the set of affected ids is knowable, pin it (`gearDetailQueryKey(publicId)`); where it isn't — a model rename, a bulk retire, a sweep close, a tag or attribute-definition edit — invalidate the namespace prefix (`GEAR_DETAIL_QUERY_KEY`). Half the gear hooks did one and half the other, so a rename left an open `/gear/$publicId` tab showing the old product name.

## Forms (`src/lib/form/`)

`useAppForm` / `withForm` come from `createFormHook`, with the shared field components in `fields.tsx`. Each form passes one Zod schema as **`onMount` + `onChange` + `onSubmit` — never `onBlur`.** TanStack Form stores errors per cause and a change re-runs only the change validator, so a form-level blur validator stamps `errorMap.onBlur` on every invalid field whenever any field blurs, and each entry clears only when that field itself blurs. On `/register/profile` that left the policies checkbox invalid after being ticked until it lost focus, holding `canSubmit` false. _When_ an error is shown is a separate question, answered by `meta.isBlurred` in `field-state.ts` — not `isTouched`, which flips on the first change.

## Server-only module boundary

TanStack Start's import-protection plugin blocks `*.server.*` from the client graph and `*.client.*` from the server graph. Three layers for any server-fn module:

1. **Leaf helpers** — `*.server.ts` (cookies, repos, rate-limit wrappers, KV stores).
2. **Action functions** — `*-actions.server.ts` hold the real business logic; tests call these directly.
3. **Shell files** (`server-fns.ts`, `webauthn-fns.ts`, `health.ts`) hold `createServerFn` definitions, zod validators, result types, and client-safe constants. Each handler body is a one-liner that dynamic-imports its action:
   ```ts
   const { fooAction } = await import("./foo-actions.server");
   return fooAction(args);
   ```
   The compiler strips handler bodies from the client bundle. Shells may `import type` from `.server.ts` (type imports erase). Routes/components only import from shells.

## Markdown surface

- `<MarkdownContent>` (`src/components/markdown/`) renders via `react-markdown` + `remark-gfm` + `remark-breaks` in a Tailwind `prose` wrapper. **No `rehype-raw`** — raw HTML pass-through is intentionally OFF for XSS safety. The `<a>` renderer only sets `target="_blank"`/rel on absolute http(s) URLs.
- `<MarkdownEditor>` (`src/components/editor/`) is TipTap WYSIWYG round-tripped to a markdown string via `tiptap-markdown` (storage stays plain text). Exposed to forms as `field.MarkdownField` (registered in `src/lib/form/form.ts`) and lazy-loaded — the bundle only ships on routes that mount it. Cap enforcement uses markdown string length, matching the zod `.max()`.

## UI primitives

**Use `radix-ui`, the unified package** — `import { Slot } from "radix-ui"`, never the legacy per-component `@radix-ui/react-*` scoped packages, which are not dependencies. Nearly every file in `src/components/ui/` is Radix-based.

**`@base-ui/react` is a single-component exception**: `combobox.tsx` only, because shadcn's Combobox has no Radix implementation. Don't reach for Base UI for anything else — a second parallel primitive stack is worse than either one alone. Standardizing on Base UI would be a deliberate full-catalog migration, not something to drift into per-component.

## Responsive collections (tables vs. stacked rows)

A collection has **two sanctioned narrow-viewport treatments, and the choice is decided by the reader's task, not by consistency with the last one written.**

| Task the surface serves                                                          | Treatment                                                                                     | Reference implementation                                                       |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Compare a value down the list** — scan availability, spot the overdue one      | Keep the table, hide the columns that aren't being compared                                   | `gear-table-view.tsx` (`hidden sm:table-cell`, `hidden md:table-cell`)         |
| **Find one record and act on it** — match a name against a paper, tap the action | Stack each row: identity on top, secondary fields demoted to one meta line, action full-width | `members.waivers.tsx` (`<ul className="sm:hidden">` + `hidden sm:block` table) |

Two different patterns is **not** the inconsistency — an undocumented choice is, because the next person flips a coin. If a surface genuinely serves both tasks, the comparison wins: a column you can scan is worth more than a row you can read, and the stacked form can't do it at all.

**A stacked row is a different element, not a restyled table.** `display: block` on `tr`/`td` looks identical and silently destroys the table's semantics — the rows stop being rows for assistive tech, so a screen-reader user loses the column associations the markup was chosen for. Render the two trees. (Shopify Polaris reached the same conclusion: `IndexTable`'s `condensed` mode swaps the `<table>` for a `<ul>` rather than restyling it.)

**Bulk selection is kept at phone width here, which is a deliberate divergence.** Polaris suppresses bulk actions in `condensed` mode on the grounds that multi-select doesn't belong on a phone. `/members/waivers` keeps it because the use case is concrete and specifically mobile: an officer stands at a meeting with a stack of signed waivers and ticks down the list. Weigh it per surface — the general case is that Polaris is right.

Whichever treatment is used, **an `overflow-x-auto` wrapper takes `overflow-y-hidden` with it.** Per CSS Overflow 3 a non-`visible` value on one axis computes the other from `visible` to `auto`, so the wrapper otherwise captures vertical scroll as well and a touch-drag slides the content inside its own box. `e2e/mobile-overflow.spec.ts` guards the related failure — anything reaching outside `PageContainer`'s gutter widens the document and makes the whole page scroll sideways.

## TypeScript & observability

- `strict: true`, path alias `#/*` → `./src/*` (mirrored in `package.json` `imports`), `@cloudflare/workers-types` globally typed.
- Workers Logs `enabled = true` with `head_sampling_rate: 1` in `wrangler.jsonc` (~7-day retention). Tail with `pnpm --filter ucmc-web exec wrangler tail [--env production]`.
