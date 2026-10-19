# 0001. A dev email outbox behind Cloudflare Access

- **Status:** Accepted
- **Date:** 2026-10-18
- **Issue:** #297

## Context

Sign-in is by emailed link, so every deployed environment needs a way to deliver mail. Until now dev sent real email through prod's Resend domain: Resend's free tier allows one verified domain per account, so the `prod` stack owned it and `dev` borrowed the sending key through a Pulumi `StackReference` (`resendOwnerStack: prod`).

That coupling has three costs. Dev spends prod's sending reputation and daily quota. Prod must `pulumi up` before dev can. And it blocks moving the Resend account to a shared `spencerwill.com` sending domain used by prod only, which is the next step in consolidating email across projects.

Dev doesn't need to email arbitrary people. It needs its developer to receive sign-in links. An earlier revision of this app logged emails to the Worker console as a fallback, which put working sign-in links in dashboard-readable Workers Logs, so whatever replaces Resend on dev has to keep the links readable only by the right person.

flareling solved the same problem the same way in its [ADR 0022](https://github.com/SpencerAWill/flareling/blob/main/docs/adr/0022-dev-email-outbox.md), on the same Cloudflare account.

## Decision

Dev stores email in D1 instead of sending it, and lists it at `/dev/outbox` behind Cloudflare Access.

- **The outbox is a sender tier** (`src/server/email/email-tier.ts`), chosen when `EMAIL_OUTBOX` is set. It beats Resend, because a Worker secret outlives the deploy that stopped uploading it and dev still carries `RESEND_API_KEY` from before this change; Mailpit beats the outbox, so local development is unchanged. `/health` reads the same function, so it reports `email:outbox` on dev.
- **Cloudflare Access guards the path.** `infra/cloudflare/outbox.ts` creates a self-hosted application for `dev.ucmc.spencerwill.com/dev/outbox` with an allow policy for `outboxViewers`. The Zero Trust organization already exists on the account, shared with flareling, so its team domain is config rather than a resource.
- **The page verifies Access's token itself** with `jose`: signature against the team's published keys, issuer, audience (that application's tag) and expiry. A loosened policy, a deleted application, or a request through a hostname no Access application covers still gets a 403. A token with no email (a service token) is refused as well. With the outbox off the path is a 404.
- **Never on prod.** `configureOutbox` throws on the `prod` stack, and the sender refuses `EMAIL_OUTBOX` without the Access settings the page verifies against, rather than filling a table nobody can read.
- **Kept a day.** The page prunes older rows on every read, and the daily retention tick sweeps the table too.
- **Rendering** is a plain HTML response with no app chrome or client bundle. It escapes everything, makes only links to the app's own origin clickable, and is sent `no-store`, `noindex` and `no-referrer`.
- **Dev holds no Resend credentials.** The dev stack drops `resendOwnerStack`, provisions no Resend resources, and `deploy.yml` no longer uploads `RESEND_API_KEY` or `RESEND_FROM` to it.
- **Dev links to the outbox where you'd look for the email.** The sign-in and add-email confirmations show "Open the dev outbox", and `/health`'s `email:outbox` row links there. The server decides: both actions return `devOutboxHref`, which is null unless the outbox tier is active, so prod can't render the link. It depends only on the environment, so the enumeration-proof sign-in response stays identical for known, unknown and rate-limited addresses.
- **The Workers answer on their custom domains only.** `workers_dev` and `preview_urls` are `false` in `wrangler.jsonc` (inherited by prod), so there is no `workers.dev` or version-preview hostname that reaches the Worker without passing through Access. The page's own token check is the backstop if that is ever switched back on.
- **The cost snapshot skips Resend on dev.** Outbox writes are not Resend sends, so dev records Resend as `sourcesUnconfigured` and writes no `resend.sends` rows; billing and analytics still run.

## Consequences

- Dev deploys and signs in without any email provider. Prod is unchanged and still needs Resend.
- The Resend account is free to move to a shared `spencerwill.com` domain owned by prod alone.
- **Working sign-in links sit in dev's D1 for up to a day.** Anyone who can read that database — the deploy and infra tokens, the dashboard — can sign in to dev as any dev user. Acceptable for dev; the reason it is refused for prod. `email_outbox` is the one table holding correspondence; turning it on for prod would be a compliance change, not a config flag.
- **The daily gear-reminder cron on dev writes to the outbox** instead of emailing whoever holds dev's test loans. That is an improvement: dev's member data is seeded or copied, and real addresses should never have been mailed from it.
- **`CLOUDFLARE_API_TOKEN` needs `Access: Apps and Policies Edit`** at account level for the dev stack's preview and `up`.
- **Access login methods are set by hand.** Organizations created since June 2026 default to the Cloudflare identity provider restricted to account members; a viewer who isn't a member of the Cloudflare account needs One-time PIN enabled under Zero Trust → Integrations → Identity providers. The policy matches whatever email the login method reports.
- **Zero Trust Free covers 50 users**, which one viewer is far inside.
- **The organization will move** into SpencerAWill/spencerwill.com#3. Until then `accessTeamDomain` is read from the dev stack's config, as flareling does.
- The post-deploy smoke test still doesn't sign in. An Access service token could let it read the outbox, but the page deliberately refuses service tokens today, so that would be a separate decision.
- The stale `RESEND_API_KEY` secret on the dev Worker is harmless because the outbox beats it, but it is still a copy of prod's key; deleting it once (`wrangler secret delete RESEND_API_KEY`, top-level env) removes it for good.
