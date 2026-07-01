# Security Policy

## Supported versions

This repository deploys a single live application from `main`:

- **prod** — <https://ucmc.spencerwill.com> (Cloudflare Worker `ucmc-web`)
- **dev** — <https://dev.ucmc.spencerwill.com> (Cloudflare Worker `ucmc-web-dev`)

Only the current `main` branch and the currently-deployed prod Worker receive security fixes. There are no tagged releases or LTS branches.

## Reporting a vulnerability

**Please do not open a public GitHub issue, discussion, pull request, or wiki edit for security reports.**

Use one of the following private channels:

1. **GitHub private vulnerability reporting** (preferred) — open a draft advisory at <https://github.com/spencerawill/ucmc.spencerwill.com/security/advisories/new>. This keeps the discussion private until a fix ships.
2. **Email** — <spencer.a.will@gmail.com>. PGP is available on request. Please include "UCMC security" in the subject.

Please include:

- A description of the issue and the impact you believe it has.
- Steps to reproduce, or a minimal proof-of-concept. A short HTTP transcript / curl invocation is ideal.
- The affected URL(s), commit SHA, or deployment (dev / prod) where you observed the behavior.
- Your name or handle for credit, if you'd like to be acknowledged in the fix's release notes.

You can expect:

- **Acknowledgement within 72 hours.**
- A triage assessment (confirmed / not-a-vuln / need-more-info) within 7 days.
- For confirmed issues, a target remediation window proportional to severity:
  - Critical (auth bypass, account takeover, data exfiltration, RCE): patched in prod within 7 days.
  - High (privilege escalation, stored XSS, sensitive data exposure to non-owners): within 14 days.
  - Medium / low: bundled into the next routine release.
- A coordinated disclosure timeline. We'll aim to publish a GitHub Security Advisory once a fix is deployed and request a CVE where appropriate.

## Scope

In scope:

- The deployed web app (`ucmc.spencerwill.com`, `dev.ucmc.spencerwill.com`) and any subdomain backed by this repository (e.g. `cdn.ucmc.spencerwill.com`, `cdn.dev.ucmc.spencerwill.com`).
- Source code in this repository, including `apps/ucmc-web/`, `infra/`, and `libs/`.
- Authentication and session handling (magic link, WebAuthn / passkeys, the `__Host-ucmc_*` cookies, proof cookies).
- Authorization / RBAC bypasses (e.g. crossing the `members:manage`, `gear:manage`, or `system_admin` line as a less-privileged user).
- Data exposure across users (one member reading another's profile, waiver attestations, audit log, etc.).
- Email enumeration, account-takeover-via-magic-link, passkey ceremony abuse, and rate-limit bypass.
- R2 / D1 / KV configuration issues that allow unauthorized access (e.g. private bucket reads bypassing the Worker).

Out of scope:

- Denial-of-service tests against the deployed app. Cloudflare absorbs most of this for us; deliberately hammering the origin is not welcome and may violate Cloudflare's ToS.
- Issues that require a compromised end-user device, browser extension, or shoulder-surfing.
- Social-engineering UCMC members, club officers, or maintainers.
- Reports based on automated scanner output without a concrete impact narrative (e.g. "missing `X-Frame-Options`" on a page with no auth surface).
- Best-practice nits with no exploit path (e.g. cookie attribute preferences that don't change the threat model, software-version fingerprinting).
- Issues in third-party services we depend on (Cloudflare, Resend, Turnstile, GitHub, Pulumi Cloud) — please report those upstream.
- Anything that violates the [Code of Conduct](./CODE_OF_CONDUCT.md), e.g. testing that exposes other users' data without authorization.

## Safe-harbor

We will not pursue or support legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, destruction of data, and degradation of service.
- Only interact with accounts they own or have explicit permission from the account holder to use.
- Give us reasonable time to remediate before public disclosure.
- Do not exploit a finding beyond what is necessary to demonstrate the vulnerability.

If in doubt about whether something is in scope or safe to test, ask first via the channels above.

## Hardening notes for contributors

Most security-relevant invariants live in [`CLAUDE.md`](./CLAUDE.md). The ones to keep front-of-mind when writing code:

- **Email normalization** is centralized in `apps/ucmc-web/src/server/auth/email-normalize.ts`. Every read or write of an email address must go through it.
- **`/verify-email`** must assert `session.userId === magicLink.target_user_id` before grafting a new address onto an account.
- **Magic-link requests** pad to ≥500ms + jitter to flatten the registered/not-registered timing oracle. Do not short-circuit this.
- **WebAuthn ceremonies** are single-use: the KV entry under `webauthn:ceremony:<id>` must be deleted (and the `__Host-ucmc_webauthn` cookie cleared) on every branch — success, failure, and timeout.
- **Server-fn shells** must not import from `*.server.ts` at runtime; use dynamic `import()` inside the handler. Module-scope server imports leak into the client bundle.
- **Markdown rendering** uses `react-markdown` without `rehype-raw`. Do not re-enable raw HTML pass-through.
- **R2 private bucket** is the default for new media. Public bucket entries must use content-hashed or opaque keys — never a guessable identifier — and must set `httpMetadata.cacheControl` at upload time (the custom domain serves stored metadata, not Worker headers).
- **Rate limit wrappers** in `apps/ucmc-web/src/server/rate-limit.server.ts` fail _open_ — keep them that way, but pair every public endpoint with the appropriate budget (`HEALTH_RATE_LIMITER` or `AUTH_RATE_LIMITER`, the latter keyed independently on `ip:` and `email:`).

Dependabot keeps dependencies patched, and `web-ci.yml` runs `pnpm audit` on every PR. If you bump a dep specifically to fix a CVE, mention the advisory ID in the commit body.
