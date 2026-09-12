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

## TypeScript & observability

- `strict: true`, path alias `#/*` → `./src/*` (mirrored in `package.json` `imports`), `@cloudflare/workers-types` globally typed.
- Workers Logs `enabled = true` with `head_sampling_rate: 1` in `wrangler.jsonc` (~7-day retention). Tail with `pnpm --filter ucmc-web exec wrangler tail [--env production]`.
