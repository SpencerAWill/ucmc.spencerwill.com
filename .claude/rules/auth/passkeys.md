---
paths:
  - "apps/ucmc-web/src/features/auth/**/*passkey*"
  - "apps/ucmc-web/src/features/auth/server/webauthn*"
  - "apps/ucmc-web/src/server/auth/signing.server.ts"
  - "apps/ucmc-web/src/routes/my._tabs.security.tsx"
  - "apps/ucmc-web/src/routes/register.pending.tsx"
  - "apps/ucmc-web/src/routes/sign-in.tsx"
  - "apps/ucmc-web/e2e/passkey*.spec.ts"
---

# Passkeys (WebAuthn)

Part of the auth rule; `auth/core.md` covers sessions and registration.

`@simplewebauthn/server` + `browser`. The RP is pinned to `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `APP_BASE_URL` (per-env from Pulumi). **Begin writes nothing**: the ceremony (id, challenge, type, user, expiry) goes into the `__Host-ucmc_webauthn` cookie, HMAC-signed with `SESSION_SECRET` under the `webauthn-ceremony` purpose (`src/server/auth/signing.server.ts`). Autofill begins one on every `/sign-in` load, so a stored row per begin would let one IP spend D1's daily write quota by reloading a page. **Finish consumes the ceremony id with one `INSERT … ON CONFLICT DO NOTHING RETURNING` into `webauthn_consumed_ceremonies`, before verifying, and clears the cookie on every branch.** Single use is one statement, never a read followed by a write — it was KV `get` then `delete` until #314, which two concurrent finishes could both pass. Magic links hold the same line with `UPDATE … WHERE consumed_at IS NULL RETURNING`. **That marker is the only replay defence for synced passkeys**, which always report a sign counter of 0 and so switch off the counter-regression check. Markers carry the ceremony's expiry and the daily retention tick sweeps them. Sign-in runs a background conditional-UI ceremony for autofill — which is why **begin is rate-limited on `CEREMONY_RATE_LIMITER` and finish on `AUTH_RATE_LIMITER`** (#306; see `data/core.md`).

**Three surfaces offer enrollment, and only one of them manages credentials.** `PasskeySection` (`/my/security`) owns the full list / add / rename / remove UI. The other two exist because `/my/security` is behind `requireApproved`, which is strictly later than the moment a member is actually at the device they want to enroll:

| Surface             | Component               | Shown to                                      |
| ------------------- | ----------------------- | --------------------------------------------- |
| `/my/security`      | `PasskeySection`        | every approved member                         |
| `/register/pending` | `PasskeyEnrollmentCard` | anyone waiting on approval                    |
| `/my/profile`       | `PasskeyNudge`          | approved members holding **zero** credentials |

The register actions require a principal, not an approved one, which is what makes the pending card legal — the same split that puts `ContactsEditor` / `BioEditor` on that page. `PasskeyNudge` is the catch-all for everyone the pending card missed, officer pre-added members above all: pre-add IS the approval signal, so they never see `/register/pending` at all. Its dismissal is `localStorage` (`ucmc:passkey-nudge:dismissed`), per-browser on purpose — a passkey is bound to the device in front of you, so declining on a lab machine shouldn't silence the prompt on your phone.

**Passkeys are offered, never required, and that is a decision rather than an unfinished state.** Magic links remain the sign-in _and_ recovery path, so a mandatory passkey adds friction without raising the bar; making it matter would mean blocking removal of the last credential and rethinking recovery. Plenty of people also register on a lab machine or a locked-down browser that can't create one, so a requirement would need an escape hatch regardless.

**All three run through `AddPasskeyButton`, which has a `compact` variant** for the two hosts with no list under them: no nickname field (a label only matters once there's a second credential to tell apart — the same reasoning that put the inline rename on `PasskeySection`) and an in-place "Passkey added on this device" confirmation, since those hosts have no re-rendering list to serve as one.

**`PasskeyNudge` snapshots "held zero credentials at page load" and never re-reads it. Do not turn that back into a live read.** Its trigger is the passkey list, and `useAddPasskey` invalidates the passkey list — so reading it live means a successful ceremony retracts the card before anyone sees the confirmation it just produced, and the member's click appears to do nothing. **A callback from the button cannot fix this**, which is the part worth remembering: React Query awaits a mutation's own `onSuccess` (where the invalidation lives) _before_ running the per-`mutate` one, so the refetch has already landed by the time any caller-supplied callback fires. That was the first implementation, it read as obviously correct, and **the component test driving the same mutation passed** — a mocked refetch settles in a microtask and loses the race the real one wins. Only `e2e/passkey-enrollment.spec.ts` caught it. The snapshot is also the honest rule: "does this member need an introduction to passkeys" is answered on arrival, and nothing they do on the page makes it a different question.

**All three are gated on `pages.my_security`, including the one that isn't under `/my`.** The flag is the switch for passkey UI, not for one route; an exec flipping it off would not expect an entry point on `/register/pending` to stay live. `/register/pending` has no `requirePageFlag` for it (the page itself must stay reachable), so the card reads `publicFlagsQueryOptions` and returns `null` — the same thing a nav entry does for a page that's switched off.

**All three lifecycle mutations are audited** — `passkey.added` / `passkey.removed` / `passkey.renamed`, `targetType: "passkey"` with `targetId` = the row's surrogate `passkey_credentials.id` (never the authenticator-supplied `credential_id`). Renames are audited even though a `nickname` is a cosmetic label with no authentication effect, because the nickname is how a member decides which credential to **revoke**: someone holding a stolen session could otherwise silently relabel passkeys to steer the victim into deleting their own and keeping the attacker's. Metadata carries `{ before, after }`; a no-op rename writes nothing. An empty/whitespace nickname clears the label rather than storing `""`. Repo helpers are scoped by `userId` (`renameCredentialForUser`, `deleteCredentialForUser`) so a caller can only touch their own credentials even if they guess someone else's ID, and both return the affected row so the audit write follows a `.returning()` that proves something actually changed.
