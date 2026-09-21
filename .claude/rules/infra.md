---
paths:
  - "infra/**"
  - ".github/workflows/**"
---

# Infrastructure (`infra/`) and CI

**Pulumi**, two stacks (`dev` auto, `prod` manual + approval), state in Pulumi Cloud, `pnpm` runtime. Auth via `CLOUDFLARE_API_TOKEN`.

The **Cloudflare provider** manages Worker custom domains, D1 databases, R2 buckets (private + public, with `R2CustomDomain` `minTls: "1.2"`), KV namespaces, and Resend DNS records (SPF, DKIM, MX). The `spencerwill.com` zone itself is NOT Pulumi-managed. D1/R2/KV are `protect: true`.

**Stack outputs consumed by `deploy.yml`:** `d1DatabaseId`, `kvNamespaceId`, `r2PublicHost` (→ `VITE_R2_PUBLIC_HOST`), `resendApiKey`, `resendFromEmail`. Bucket names are exported for drift detection only — wrangler binds buckets by name.

## Resend (`infra/resend.ts`)

A custom `ResendDomain` component shells out to `infra/scripts/resend.mjs` via `@pulumi/command` — **no dynamic provider, because pnpm and Pulumi dynamic providers don't mix** (pulumi/pulumi#9085).

Prereq: `RESEND_MANAGEMENT_API_KEY` (full-access) as a GitHub env secret on both environments, and exported locally for `pulumi up`.

**Single-domain sharing** (free-tier limit): prod owns the `ResendDomain`; dev sets `resendOwnerStack: prod` and reads `resendApiKey` + `resendFromEmail` via `pulumi.StackReference`. **Prod must `pulumi up` before dev** so the StackReference resolves. The component is `protect: true` — destroying it re-issues DKIM and invalidates the sending token.

## Workflows

- `ci.yml` — per-PR. A paths-filter gates web lint/typecheck/vitest and the browser-spec job (axe a11y + the gear-scanner decode specs, sharing one dev server) and infra lint/typecheck + `pulumi preview`; the workspace audit always runs.
- `deploy.yml` — push-to-main auto-deploys dev with infra-dev → web-dev chaining; prod via `workflow_dispatch` with environment approval. It rewrites `wrangler.jsonc`'s placeholder `database_id` / KV id from Pulumi outputs, and supplies vars via `--var` flags plus `wrangler secret put`.
- `seed-admin.yml` — manual sysadmin promotion. Remote sysadmin seeding is this Action, **not** a script.
- `lint-pr.yaml` — PR title lint.

**`deploy.yml` runs `d1 migrations apply` _before_ `wrangler deploy`.** That ordering opens a window where the previous Worker runs against the new schema — see the `rename-permission-or-setting` skill for what that means for renames.
