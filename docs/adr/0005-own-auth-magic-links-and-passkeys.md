# 0005. Our own auth: magic links, optional passkeys, sessions in D1

- **Status:** Accepted
- **Date:** 2026-04-16 (passkeys 2026-04-23)
- **Issue:** none; PRs from 2026-04-16 on, later #241, #306, #314

## Context

Members are students and alumni who join once a year, often on a shared lab machine, and many will never remember a password. The site runs on Workers + D1 on the free tier. A hosted identity provider adds an account, per-user pricing, a second place where users live, and a network hop on every session check. Auth libraries bring their own tables and assumptions, which then need adapting to D1's limits (ADR 0006) and to Workers.

Account approval is a human step. An officer approves each new member, or pre-adds them, so sign-in only has to prove control of an email address.

## Decision

We own authentication in `src/server/auth/` and `features/auth/`, with no passwords:

- **Magic links are the way in and the recovery path.** Requests are padded (≥500 ms plus jitter) and answer the same whatever the outcome. Consuming a link takes a click, a POST, because email scanners prefetch links. Single use is one conditional `UPDATE … RETURNING`.
- **Passkeys (`@simplewebauthn`) are an optional shortcut, never required.** Begin writes nothing: the ceremony goes in an HMAC-signed cookie. Finish consumes the ceremony with one `INSERT … ON CONFLICT DO NOTHING RETURNING`, the only replay defence for synced passkeys.
- **Sessions** are an opaque id in an `HttpOnly`, `SameSite=Lax`, `__Host-` cookie, with the row in D1. They last 30 days and slide at most hourly. Revoking is deleting the row.
- **Several verified emails per account**, one primary, globally unique after normalization.
- **RBAC with roles and permissions as D1 rows** (ADR 0010), runtime-editable at `/access`, with role emulation for previewing.
- **Abuse controls before database work**: Cloudflare's Rate Limiting binding (fails open) and Turnstile (fails open while no secret is set).

## Consequences

- No vendor and no per-user cost. A session check is one indexed D1 read.
- Security fixes are ours to make. Two that came out of comparison with flareling are done: ceremonies moved from KV, where read-then-delete isn't atomic, to a D1 marker (#314), and starting a passkey ceremony got its own rate-limit budget (#306).
- **Known gaps:** sliding refreshes the row's `expires_at` but does not re-send the cookie, so the browser still drops it 30 days after sign-in (#374). The session id is stored as-is rather than hashed, so a D1 read leak is a session leak (#375). Nothing sweeps expired sessions or magic links: a session row is deleted only if its cookie comes back after expiry, and a magic link never (#373).
- Email delivery is part of sign-in itself. With no transport configured, sending throws (ADR 0001); there is no console fallback.
- Not built: SSO, a session list with remote sign-out, self-service account deletion and export.
