---
paths:
  - "apps/ucmc-web/e2e/smoke.spec.ts"
  - "apps/ucmc-web/playwright.config.ts"
  - ".github/actions/deploy/**"
---

# Testing: the post-deploy smoke spec

Part of the E2E guidance in `testing-e2e.md`.

### `smoke.spec.ts` — the only spec that runs against a real deployment

The deploy workflow used to apply D1 migrations and push a worker to production with nothing checking the result. A deploy that 500s on every request, or one whose client bundle throws on hydration, was indistinguishable from a good one until a human loaded the site.

The smoke steps live **inside** the deploy action (`.github/actions/deploy`), run by `Deploy — dev` and `Deploy — prod`, not in jobs of their own: a separate job would re-run checkout, setup-node and `pnpm install` to learn something the deploy job can check directly, and would need `app_base_url` plumbed through as a job output. Inside, a smoke failure also turns the deploy red, which is what "fail loudly" has to mean — and on prod it triggers `wrangler rollback`, so prod returns to the previous Worker version.

- **`PLAYWRIGHT_BASE_URL` does double duty.** It sets `baseURL` _and_ suppresses the `webServer` block — booting `pnpm dev` against a remote target would waste two minutes and then test the wrong thing. Anything that reads `BASE_URL` must keep that coupling in mind.
- **The spec must stay read-only and unauthenticated.** It runs against production. No sign-in, no seeding, no mutation.
- **It asserts hydration, which is the half a `curl` cannot see.** SSR HTML comes back fine from a worker whose client bundle is broken — a module reaching for `cloudflare:workers` outside SSR, a chunk 404ing against a stale asset manifest — and the page then looks correct while responding to nothing. It carries the same `#main` height guard as `reflow-pages.spec.ts`, for the same reason: an error boundary also returns 200 and hydrates.
- **`/health` is asserted through its `<h1>`, not a test id.** `report.status` is `pass` only when every probe passed, so the heading covers `d1:read`, `r2:head`, KV and the email provider in one assertion — and the page returns 200 either way, which is why curling it proves nothing. The per-probe rows are scraped into the failure message so a red deploy names the broken binding.
- **`E2E_PREVIEW=1` runs it against the production build instead of a dev server.** `webServer` becomes `pnpm build && pnpm preview`, which serves `dist/` through workerd — the artifact `wrangler deploy` ships. CI runs this on every web PR, because `vite dev` is _not_ the worker that ships: the build splits chunks, stubs `cloudflare:workers` out of the client bundle, bundles for SSR and writes an asset manifest, and dev transforms modules on demand and papers over all of it.
- **The `/health` test carries the `@deployed` tag and the build run excludes it.** Against `vite preview` the worker's outbound fetch to a loopback Mailpit **does not arrive**, while the dev server's **does** — verified both ways, so don't assume either. The email probe would therefore fail for a reason that says nothing about the build, and D1/R2/KV there are Miniflare rather than real bindings. The full smoke, tag included, runs after each deploy.
- **It is confined to its own project rather than left in `chromium`.** Against a Miniflare dev server the `/health` assertion is either vacuous or flaky depending on which local binding happens to be warm, and a smoke test that is routinely yellow on PRs stops being read on the one run that matters.
