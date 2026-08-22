# ucmc-web

Member portal for the **University of Cincinnati Mountaineering Club** (UCMC), a Registered Student Organization. Deployed at <https://ucmc.spencerwill.com> with a dev twin at <https://dev.ucmc.spencerwill.com>.

This file is the human-developer entry point. For the model's source of truth (every tooling, env, and test convention), see [`/CLAUDE.md`](../../CLAUDE.md). For the legal/policy obligation → site behavior matrix, see the wiki's [compliance matrix](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki/Compliance).

## Stack

- **TanStack Start** (file-router mode) + **React 19** + **Vite 8**
- **Cloudflare Workers** runtime, Wrangler-deployed (`wrangler.jsonc`)
- **D1** (SQLite) for the database, **R2** for avatars + landing images, **KV** for short-lived auth state
- **Drizzle ORM** + **drizzle-kit** for schema + migrations
- **shadcn/ui** + **Tailwind CSS v4**
- Auth: **magic link** (Resend → Cloudflare-hosted email) and **WebAuthn passkeys**, both backed by KV-stored ceremonies
- Tests: **Vitest** (workers + jsdom pools) for units, **Playwright + axe-core** for e2e accessibility

## Running it

```bash
pnpm install                              # at the repo root
pnpm --filter ucmc-web dev                # http://localhost:3000
pnpm --filter ucmc-web db:migrate:local   # apply migrations to Miniflare D1
pnpm --filter ucmc-web db:seed:local      # promote SEED_ADMIN_EMAIL to system_admin
```

`.env.local` (gitignored) needs the values listed in `.env.example`. The devcontainer ships a Mailpit sidecar; with `MAILPIT_URL` set and `RESEND_API_KEY` unset, magic-link emails land at <http://localhost:8025>.

```bash
pnpm --filter ucmc-web test               # Vitest (workers + jsdom)
pnpm --filter ucmc-web typecheck          # tsc --noEmit
pnpm --filter ucmc-web lint               # eslint
pnpm --filter ucmc-web e2e                # Playwright (full suite)
pnpm --filter ucmc-web e2e a11y.spec.ts   # just the axe-core gate
pnpm --filter ucmc-web build              # production worker bundle
pnpm --filter ucmc-web storybook          # http://localhost:6006
```

## Source layout

Bulletproof React–aligned. Three features under `src/features/`:

- `auth/` — magic-link + passkey flows, the user's own profile/avatar editing, the `useAuth`/`view-mode`/`guards.ts` "auth public API" surface, the waiver guard.
- `members/` — registration approval queue, member directory, admin profile editing, RBAC, paper-waiver attestation queue.
- `announcements/` — admin-authored announcements feed with read-tracking.

Plus `landing/` for the editable public homepage. Shared/foundational code stays outside features: `server/auth/`, `server/profile/`, `server/r2/`, `server/kv/`, `server/db/`, `components/`, `lib/`, `hooks/`, `config/`. Routes (`src/routes/`) compose features but never the reverse — enforced mechanically by `import/no-restricted-paths` in `eslint.config.js`.

## Routes worth knowing

### Public legal / disclosure routes

Required for the site to use the UC name (UC Rule 40-03-01) and to satisfy state/federal requirements.

| Route                | What it is                                                                        |
| -------------------- | --------------------------------------------------------------------------------- |
| `/disclaimer`        | Verbatim Rule 40-03-01 registration disclaimer + UCMC-vs-UC-Health disambiguation |
| `/nondiscrimination` | UC protected categories + Ohio SB 1 + EO 2022-06D antisemitism definition         |
| `/anti-hazing`       | UCMC stance + links to UC's hazing policy + Maxient + Ohio anonymous tip line     |
| `/waiver`            | Transcribed waiver of liability text + canonical PDF download                     |
| `/privacy`           | Data inventory, processors, retention, cookies, deletion path                     |
| `/terms`             | Acceptable use, no-UC-endorsement, Ohio governing law                             |
| `/about`             | What UCMC is + the additive-not-canonical relationship to CampusLINK              |
| `/membership`        | Eligibility, dues, verification (not gatekeeping) framing                         |
| `/legal`             | Index page surfacing all of the above                                             |
| `/open-source`       | Colophon (this site is open source; see the linked GitHub repo)                   |

The footer also shows the registration disclaimer text **on every page** (not just `/disclaimer`); that's a Rule 40-03-01 hard requirement, implemented in `apps/ucmc-web/src/components/layouts/app-layout.tsx`.

### Auth-gated routes

- `/my/profile` (public profile), `/my/details` (private PII + email addresses), `/my/contacts` (emergency contacts), `/my/security` (passkeys), `/my/preferences` (theme + data export + hard delete) — the member's own account surface, sharing a greeting + tab bar via the pathless `my._tabs` layout. `/my` itself redirects to `/my/profile`.
- `/my/waiver` — read-only view of the member's paper-waiver attestation status
- `/members` — directory (auth-gated, robots-disallowed). Approved members see only the approved tab; officers with `members:manage` see a tab bar with four additional siblings:
  - `/members/pending` — approve pending registrations
  - `/members/unclaimed` — pre-add unclaimed members (off-platform stubs)
  - `/members/rejected` — un-reject rejected registrations
  - `/members/deactivated` — reactivate deactivated members
- `/members/waivers` — officer attestation queue (`waivers:verify`; held by Treasurer + President)
- `/access` — roles and permissions editor (`roles:manage`). Root-level, not under `/members`: roles govern every feature, not just membership, so it sits next to Settings in the sidebar's bottom group.
- `/settings` — runtime platform configuration (`settings:manage`), driven entirely by the Zod registry in `src/server/settings/settings-registry.ts`. This is where the club email, the Instagram / Facebook / YouTube links, and the per-page kill switches are edited. The footer and the landing page's "Where to find us" block both read the contact values from here, so neither surface hardcodes them.

## Compliance conventions

These are non-obvious decisions that affect what code is allowed to do:

### M-numbers are not collected

UC's student/staff ID number is intentionally **not** stored anywhere — schema, forms, exports. The canonical roster lives on CampusLINK, maintained by the Treasurer per Bylaw 1.3. This avoids a FERPA-adjacent edge case and keeps the site additive rather than canonical.

### Waiver attestation is paper-in-hand, not digital upload

Members print and sign the canonical PDF (`apps/ucmc-web/public/legal/ucmc-waiver-v1.pdf`), then physically hand it to an officer. The officer marks the member attested for the current cycle via `/members/waivers`. The signed paper lives off-platform with the Treasurer; **medical PII never touches Cloudflare**, no R2 PDFs, no signature images.

The attestation row schema is `(userId, cycle, version)` together — the `requireCurrentWaiver` guard requires all three to match `currentWaiverCycle()` and `WAIVER_VERSION`. Re-attestation is required every fall semester; the cycle rolls over on August 15.

### Compliance content source of truth

`apps/ucmc-web/src/config/legal.ts` holds every legal/policy string rendered by the site — the registration disclaimer, all nine legal-route bodies, the canonical `WAIVER_PDF_PATH`, `WAIVER_VERSION`, and `POLICIES_VERSION`. Edits to these strings are legal review, not word-smithing — the on-site text must match the canonical PDF byte-for-byte. Bumping `WAIVER_VERSION` invalidates every existing waiver attestation.

`apps/ucmc-web/src/config/waiver-cycle.ts` is the **only** place that should compute "what cycle are we in." Always import `currentWaiverCycle()`; never derive it ad-hoc.

### Retention is automated

A daily Cloudflare cron (08:00 UTC, see `wrangler.jsonc` `triggers.crons` and `apps/ucmc-web/src/server/cron/retention.server.ts`) sweeps:

- Rejected registrations 30 days after rejection
- Deactivated accounts 12 months after deactivation
- Revoked waiver attestations 90 days after revocation
- R2 objects (avatars + landing images) not referenced by any DB row, with a 5-minute upload-race age guard

Pre-migration rows with NULL `rejected_at` / `deactivated_at` are deliberately skipped — historical state isn't auto-purged retroactively.

### WCAG 2.1 AA, gated in CI

`eslint-plugin-jsx-a11y` runs at error on every PR, and a Playwright job runs axe-core against every public + auth-entry route, failing on serious/critical violations. UC EIT 9.2.1 effectively makes this binding for an official RSO surface.

## Adding common things

### A new route

Drop a file in `src/routes/`. TanStack Router's file-router conventions apply: `route.tsx` for a regular page, `__root.tsx` for the shell, `_layout/foo.tsx` for nested layouts, `$param.tsx` for dynamic segments, dot-separated segments for paths with slashes. The `routeTree.gen.ts` regenerates on `pnpm dev`. See [TanStack Router file-routing docs](https://tanstack.com/router/latest/docs/framework/react/guide/file-based-routing) for the full convention surface.

### A new database column / table

1. Edit `drizzle/schema.ts`.
2. `pnpm --filter ucmc-web db:generate` — produces `drizzle/migrations/NNNN_<auto-name>.sql`.
3. **Rename the file** to something descriptive and update `meta/_journal.json` to match — auto-generated names rot fast.
4. Apply locally with `pnpm --filter ucmc-web db:migrate:local`.
5. CI applies it on the next deploy.

### A new shadcn/ui component

```bash
pnpm dlx shadcn@latest add <component>
```

Files land in `src/components/ui/` per the project's `components.json` config.

### A new server function

Three-layer pattern (server-only module boundary requires this; see `/CLAUDE.md` for the full reasoning):

1. **Leaf helpers** in `*.server.ts` — D1/R2/KV access, cookies, rate limiting.
2. **Action functions** in `*-actions.server.ts` — the actual business logic. Tests call these directly.
3. **Shell** in `*-fns.ts` — `createServerFn` definitions whose handler bodies are one-liners that dynamic-import the action module. Route files and form components only import from the shell.

## Deployment

Auto-deploys to dev on merge to main; prod is manual via `workflow_dispatch` on `web-deploy.yml` with a GitHub environment approval gate. Custom domain bindings, D1 / R2 / KV resources, the Resend sending domain, and DNS records are provisioned by Pulumi (`infra/`). Don't `wrangler deploy` from a developer machine — it bypasses CI's secret + env handling.

## Where to read more

- [`/CLAUDE.md`](../../CLAUDE.md) — full tooling/conventions reference
- [Compliance](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki/Compliance) (wiki) — obligation → site behavior matrix
- [Ohio Law and Student Organizations](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki/Ohio-Law-and-Student-Organizations), [UC Trademark and Licensing for RSOs](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki/UC-Trademark-and-Licensing-for-RSOs), [UC RSO Resources](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki/UC-RSO-Resources) (wiki) — research that drove the compliance design
- [UCMC Constitution & Bylaws](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki/UCMC-Constitution-%26-Bylaws) (wiki) — governance reference
