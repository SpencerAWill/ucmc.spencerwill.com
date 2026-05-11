# CLAUDE.md

## Project

UCMC (University of Cincinnati Mountaineering Club) — pnpm monorepo (v10.33+, ESM-only).

- `apps/web/` — TanStack Start + React 19 + Vite 8 + Tailwind v4 + shadcn, deployed to Cloudflare Workers via Wrangler
- `infra/` — Pulumi (TypeScript, two stacks: `dev`, `prod`)
- `libs/` — shared libraries
- `.devcontainer/` — Debian-based devcontainer with Node 22, Pulumi, gh, Claude Code, Playwright, Mailpit sidecar
- `.wiki/` — git submodule, auto-synced via husky hooks + CI

## Tooling

- **Lint/format**: ESLint v10 flat config, Prettier, EditorConfig. Sub-apps extend root config.
- **Hooks**: Husky — pre-commit (lint-staged), commit-msg (commitlint), post-merge/checkout/pre-push (wiki submodule).
- **Commits**: Conventional Commits enforced. Scopes validated against pnpm workspace names + `wiki`, `devcontainer`. Use `pnpm commit`.
- **CI**: `web-ci.yml` (lint+typecheck+vitest, axe a11y), `web-deploy.yml` (auto dev / approved prod), `infra-ci.yml` + `infra-deploy.yml`, `seed-admin.yml` (manual sysadmin promotion), `sync-wiki.yml`, `lint-pr.yaml`.

## Web app (`apps/web`) — load-bearing invariants

### Source layout (Bulletproof React)

Features under `src/features/`: `auth`, `members`, `announcements`, `feedback`, `landing`, `audit`, `waivers`. Each has `components/`, `api/` (`query-keys.ts`, `queries.ts` exposing `*QueryOptions()` factories, per-mutation `use-*.ts` hooks), `server/` (server fns + actions + repos + tests).

Shared/foundational code lives outside features: `src/server/auth/`, `src/server/profile/`, `src/components/` (UI primitives, `profile/`, `layouts/`, `markdown/`, `editor/`), `src/lib/`, `src/hooks/`, `src/config/`. Routes (`src/routes/`) compose features but never the reverse.

`import/no-restricted-paths` (in `apps/web/eslint.config.js`) enforces these boundaries: features can't import each other (the only exceptions are auth's `api/use-auth.ts` + `api/view-mode.tsx` + `guards.ts`, plus auth's read access to `features/waivers/api/queries.ts`); shared code can't import features. Tests are exempt.

The audit **recorder** (`recordAuditEvent` etc.) stays in `src/server/audit/audit-log.server.ts` because it's cross-feature foundational; only the read-side viewer lives in `features/audit/`.

### API layer

Inline `useMutation` in routes/components is forbidden. Each mutation has a `use-*.ts` hook with a fixed cache-invalidation contract; call sites pass `onSuccess`/`onError` to `mutate()`.

### Server-only module boundary

TanStack Start's import-protection plugin blocks `*.server.*` from client graph and `*.client.*` from server graph. Three-layer pattern for any server-fn module:

1. **Leaf helpers** — `*.server.ts` files (cookies, repos, rate-limit wrappers, KV stores).
2. **Action functions** — `*-actions.server.ts` files contain the real business logic; tests call these directly.
3. **Shell files** (`server-fns.ts`, `webauthn-fns.ts`, `health.ts`) hold `createServerFn` definitions, zod validators, result types, client-safe constants. Each handler body is a one-liner that dynamic-imports its action: `const { fooAction } = await import("./foo-actions.server"); return fooAction(args);`. The compiler strips handler bodies from the client bundle. Shells may `import type` from `.server.ts` (type imports erase). Routes/components only import from shells.

### Cloudflare bindings

- **D1** (Drizzle ORM) — schema `drizzle/schema.ts`, generated migrations committed in `drizzle/migrations/`. `wrangler.jsonc`'s `database_id` is a placeholder; web-deploy rewrites it from Pulumi `d1DatabaseId` output.
- **KV** — same UUID-injection pattern (`kvNamespaceId` Pulumi output).
- **R2** — name-based bindings (no UUID injection). Two buckets per env: `BUCKET_PRIVATE` (worker-mediated reads, default for new media) and `BUCKET_PUBLIC` (bound to `cdn.{dev.,}ucmc.spencerwill.com` via `R2CustomDomain`, reads bypass worker). **Use `getPrivateBucket()` for any new media unless URL shape is unguessable AND content is intended public.** Avatars + landing images use content-hashed keys + opaque public IDs in the public bucket. Public uploads MUST set `httpMetadata.cacheControl` at upload time (custom domains pass through stored metadata, not worker headers).
- **Function-wrapped access invariant**: never read `env.DB` / `env.KV` / `env.BUCKET_*` at module scope. Always go through `getDb()` / `getKv()` / `getPrivateBucket()` / `getPublicBucket()`. The `cloudflare:workers` module is stubbed for non-SSR bundles by a vite plugin, so module-scope access breaks the client build.
- **Rate limiting** — two `unsafe.bindings`: `HEALTH_RATE_LIMITER` (20/60s per IP) and `AUTH_RATE_LIMITER` (10/60s per key, with `ip:` and `email:` keys for independent budgets). Wrappers in `apps/web/src/server/rate-limit.server.ts` fail _open_. `E2E_BYPASS_RATE_LIMIT=1` short-circuits for Playwright.

### Auth + identity

- **Session/principal** lives in `src/server/auth/`. Principal exposes `primaryEmail: string` and `emails: string[]`.
- **Multiple verified emails per user**: `user_emails` table with one `is_primary = 1` row enforced by partial unique index. `users` has no `email` column — every read joins. Global `UNIQUE(email)` means an address belongs to exactly one account; race safety relies on the constraint via `isUniqueViolation()` in `src/server/db/index.ts`. **All inserts/lookups must go through `apps/web/src/server/auth/email-normalize.ts`** (`trim().toLowerCase()`). Adding email = magic-link round-trip with `intent = "add_email"`; `/verify-email` asserts `session.userId === magicLink.target_user_id` so a stranger can't graft an address onto another account. Promotion is a `db.batch` swap (SQLite enforces partial-unique at statement boundaries). Removing primary or last row is blocked.
- **Magic link**: `requestMagicLinkAction` pads response to ≥500ms + 0–300ms jitter to flatten the registered/not-registered timing signal. Only the publicly-enumerable request endpoint gets jitter.
- **Turnstile**: client widget gated on `VITE_TURNSTILE_SITE_KEY`; server verify in `features/auth/server/turnstile.server.ts` fails open when `TURNSTILE_SECRET_KEY` unset.
- **Passkeys (WebAuthn)**: `@simplewebauthn/server`+`browser`. RP pinned to `WEBAUTHN_RP_ID`/`WEBAUTHN_RP_NAME`/`APP_BASE_URL` (per-env from Pulumi). Each ceremony stashes challenge in KV at `webauthn:ceremony:<id>` (5-min TTL) + sets `__Host-ucmc_webauthn` cookie. Finish deletes KV entry (single-use) and clears cookie on every branch. Sign-in runs background conditional-UI ceremony for autofill.
- **`/register/profile`** accepts proof cookie (first-time, no `users` row yet) OR session cookie (returning user with no `profiles` row). `requireRegistrationContext` exposes `{ source, email }`.
- **Officer pre-add ("unclaimed" members)**: `members:manage` officers bulk-add by name+email so off-platform records FK to a stable `users.id`. Unclaimed users have `status="unclaimed"`, `placeholder_name`, `unclaimed_at`, primary `user_emails` row with `verified_at = NULL`. First magic-link click flips to approved on profile submit (skipping pending queue) — pre-add IS the approval signal. Audit chain: `member.pre_added` → `member.claimed`. Excluded from public directory and RBAC role assignment.

### Compliance / legal

- **`apps/web/src/config/legal.ts`** is the source-of-truth for every legal/policy string the site renders, plus `WAIVER_PDF_PATH`, `WAIVER_VERSION`, `POLICIES_VERSION`. **Site copy must match the canonical PDF byte-for-byte; treat copy edits to `/disclaimer`, `/nondiscrimination`, `/anti-hazing`, `/waiver`, `/privacy`, `/terms`, `/about`, `/membership`, `/legal`, `/open-source` as legal review, not word-smithing.**
- **Bumping `WAIVER_VERSION` invalidates every existing attestation** (`requireCurrentWaiver` filters on `(userId, cycle, version)` together — non-revoked is not enough). `POLICIES_VERSION` is informational; no guard re-prompts.
- **Waiver cycle**: `apps/web/src/config/waiver-cycle.ts` exports `currentWaiverCycle(now)` returning `"YYYY-YY"`. Rolls over **August 15** (`CYCLE_ROLLOVER_MONTH_DAY`). Worker runs UTC; rollover is calendar-day local-feel. **Never compute the cycle ad-hoc — always import the helper.** Tests pin `now`.
- **Compliance matrix** in `.wiki/Compliance.md` maps each obligation (Ohio law, UC trademark, FERPA, Clery, EIT 9.2.1, bylaws) to the file/route satisfying it. Update it when adding compliance-shaped features.
- The registration disclaimer (UC Rule 40-03-01) uses inline-style font to survive Tailwind purging.

### Markdown surface

- `<MarkdownContent>` (`src/components/markdown/`) renders via `react-markdown` + `remark-gfm` + `remark-breaks` in a Tailwind `prose` wrapper. **No `rehype-raw`** — raw HTML pass-through is intentionally OFF for XSS safety. The `<a>` renderer only sets `target="_blank"`/rel on absolute http(s) URLs.
- `<MarkdownEditor>` (`src/components/editor/`) is TipTap WYSIWYG round-tripped to a markdown string via `tiptap-markdown` (storage stays plain text). Exposed to forms as `field.MarkdownField` (registered in `src/lib/form/form.ts`) and lazy-loaded — the ~265KB-gz bundle only ships on routes that mount it. Cap enforcement uses markdown string length (matches zod `.max()`).

### Env

`@t3-oss/env-core` + zod (`src/config/env.ts`) for `VITE_*` client vars. Server vars (`APP_BASE_URL`, `WEBAUTHN_RP_*`, `RESEND_*`, `SESSION_SECRET`, `MAILPIT_URL`) reach handlers via the Worker `env` binding through `src/server/cloudflare-env.ts`. Local dev loads from `apps/web/.env.local` per wrangler v4 `.env` precedence (`.dev.vars` is no longer used). Devcontainer sets `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` so host shell env wins over `.env.local`. Deployed envs get vars from Pulumi `--var` flags + `wrangler secret put` via `web-deploy.yml`.

Email three-tier fallback (`src/server/email/resend.ts`): (1) Resend API if `RESEND_API_KEY`, (2) Mailpit at `MAILPIT_URL`, (3) Worker console log.

### Testing

- **`workers` pool** (`vitest.workers.config.ts`) — `*.test.ts` in real workerd via `@cloudflare/vitest-pool-workers` (vitest 4.x + pool 0.16.x). Wired as a Vite plugin (`cloudflareTest()`) — there's no `defineWorkersConfig` / `poolOptions.workers` in this version. Migrations applied once per file via `test/apply-migrations.ts`; storage isolation is **per file, not per test**, so any test that writes to D1 must include the relevant tables in its own `beforeEach` cleanup (`auditLog` is a common one to forget). Cookie helpers + rate-limit wrappers are `vi.mock`ed (no request context).
- **`dom` pool** (`vitest.dom.config.ts`) — `*.test.tsx` in jsdom + Testing Library + user-event. `cloudflare:workers` aliased to `test/cloudflare-workers-stub.ts`. `pnpm --filter ucmc-web test` runs both pools.
- **E2E** — Playwright drives Chromium against a freshly-spawned dev server. `e2e/fixtures/mailpit.ts` polls Mailpit for magic links. `e2e/fixtures/hydration.ts` `waitForHydration(page)` polls `window.$_TSR.hydrated` (premature interaction is the source of every flake). `e2e/fixtures/db.ts` seeds via `wrangler d1 execute`. webServer config sets `E2E_BYPASS_RATE_LIMIT=1` and clears Turnstile keys (10/60s budget can't cover a suite from one IP; Turnstile blocks `networkidle` and steals focus). Only `a11y.spec.ts` runs in CI today.

### Misc

- **TS**: `strict: true`, path alias `#/*` → `./src/*` (mirrored in `package.json` `imports`), `@cloudflare/workers-types` globally typed.
- **Observability**: Workers Logs `enabled = true` with `head_sampling_rate: 1` in `wrangler.jsonc` (~7-day retention). Tail with `pnpm --filter ucmc-web exec wrangler tail [--env production]`.
- **Feedback feature**: optionally mirrors submissions to GitHub Issues when both `FEEDBACK_GITHUB_TOKEN` (fine-grained PAT, Issues r/w) and `FEEDBACK_GITHUB_REPO` are set. Issue body uses opaque `users.publicId` only — never email or name. Best-effort: GitHub failures don't block the D1 insert.
- **Member management** (`/members/management`): four tabs (Pending, Unclaimed, Rejected, Deactivated), all gated by `members:manage`. The dedicated `registrations:approve` permission was collapsed in migration `0027`. The `/members` directory always shows approved-only.
- **Gear inventory** (`/gear`, `/gear/$publicId`, `/gear/types`): every piece of club equipment is a row in `gear`, exclusively partitioned by a `gear_types` row and tagged via the `gear_tag_assignments` join. Each piece is referenced on its laminated/QR tag by a **freeform `code`** string (e.g. `CH93`) — `code` is nullable + unique. Retiring NULLs the column so the same string can be reissued on a new piece; the `gear.retired` audit event captures `priorCode`. Lifecycle (`active`/`retired`) and condition (`serviceable`/`needs_repair`/`missing`/`lost`) are intentionally orthogonal so a future loan/checkout table (`gear_loans`) can land without reshaping `gear`. Browse is gated by `gear:read` (auto-granted to `role_member`); create/edit/retire/import and type/tag management require `gear:manage`. Bulk CSV import lives at `/gear` "Bulk import" and reuses the same papaparse helper pattern as members' pre-add sheet.

## Infrastructure (`infra/`)

- **Pulumi**, two stacks (`dev` auto, `prod` manual+approval), state in Pulumi Cloud, `pnpm` runtime.
- **Cloudflare provider** manages: Worker custom domains, D1 databases, R2 buckets (private + public, with `R2CustomDomain` `minTls: "1.2"`), KV namespaces, Resend DNS records (SPF, DKIM, MX). The `spencerwill.com` zone itself is NOT Pulumi-managed. D1/R2/KV are `protect: true`. Auth via `CLOUDFLARE_API_TOKEN`.
- **Stack outputs** consumed by `web-deploy.yml`: `d1DatabaseId`, `kvNamespaceId`, `r2PublicHost` (→ `VITE_R2_PUBLIC_HOST`), `resendApiKey`, `resendFromEmail`. Bucket names exported for drift only (wrangler binds by name).
- **Resend** (`infra/resend.ts`) — custom `ResendDomain` component shells out to `infra/scripts/resend.mjs` via `@pulumi/command` (no provider; pnpm + dynamic providers don't mix — pulumi/pulumi#9085). Prereq: `RESEND_MANAGEMENT_API_KEY` (full-access) as a GitHub env secret on both environments and exported locally for `pulumi up`. **Single-domain sharing** (free tier limit): prod owns the `ResendDomain`; dev sets `resendOwnerStack: prod` and reads `resendApiKey` + `resendFromEmail` via `pulumi.StackReference`. **Prod must `pulumi up` before dev** so the StackReference resolves. Component is `protect: true`; destroy re-issues DKIM and invalidates the sending token.

## Commands

- `pnpm install`, `pnpm commit`, `pnpm exec eslint .`, `pnpm exec prettier --write .`, `pnpm wiki:push`
- `pnpm --filter ucmc-web {dev,build,test,typecheck,storybook,e2e,e2e:ui}`
- `pnpm --filter ucmc-web {deploy:dev,deploy:prod}`
- `pnpm --filter ucmc-web {db:generate,db:migrate:local,db:seed:local}` — remote sysadmin seeding is the `seed-admin.yml` GitHub Action, not a script
- `cd infra && pulumi {preview,up}`

## Instructions for Claude

- Follow existing ESLint + Prettier config; don't disable rules without approval.
- `const` not `let`/`var`, strict equality, always brace control flow, ESM only.
- New sub-apps: add to `pnpm-workspace.yaml`, extend root ESLint, layer on `typescript-eslint`.
- Conventional Commits with workspace-name scopes.
- **Update both README.md and this file in the same change** when tooling, scripts, workflows, or repo structure change. No drift.
