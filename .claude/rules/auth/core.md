---
paths:
  - "apps/ucmc-web/src/server/auth/**"
  - "apps/ucmc-web/src/features/auth/**"
  - "apps/ucmc-web/src/features/members/**"
  - "apps/ucmc-web/src/routes/access.tsx"
  - "apps/ucmc-web/src/routes/members.*"
  - "apps/ucmc-web/src/routes/members._tabs*"
  - "apps/ucmc-web/src/routes/my.tsx"
  - "apps/ucmc-web/src/routes/my._tabs*"
  - "apps/ucmc-web/src/routes/register.*"
  - "apps/ucmc-web/src/routes/sign-in.tsx"
  - "apps/ucmc-web/src/routes/verify-email.tsx"
---

# Auth, identity, and RBAC

Why auth is ours (magic links, optional passkeys, sessions in D1) and its known gaps: `docs/adr/0005-own-auth-magic-links-and-passkeys.md`. Why permissions are rows: `docs/adr/0010-registries-not-rows.md`. This file is the rules for changing it.

The rest of the auth rule is split by area under `.claude/rules/auth/` and loads with its files: `passkeys.md`, `access.md` (the `/access` panel and role sheet), `emulation.md` (role preview, the `anonymous` floor, `hasPermission`).

## Where things go

- **`src/server/auth/`**: sessions (`session.server.ts`, `session-config.ts`, `session-cookie.server.ts`), the principal (`principal.server.ts`), `email-normalize.ts`, signing.
- **`features/auth/`**: magic links, WebAuthn, Turnstile (`server/turnstile.server.ts`), guards (`guards.ts`, including the permission-pair constants `WAIVER_VIEW_PERMISSIONS`, `FEEDBACK_MANAGE_PERMISSIONS`), and `lib/post-sign-in.ts` (`postSignInHref` / `callbackHref`, the post-sign-in decision table shared by `/auth/callback`, both passkey paths and the registration form).
- **`safeReturnPath`** (`src/lib/`) is the one return-path validator; `signInReturnPath` builds the value.
- **`user_emails`**: several verified emails per user, one `is_primary = 1` (partial unique index), global `UNIQUE(email)`. `users` has no `email` column.
- **`/members`**: Approved is the default tab; Pending / Unclaimed / Rejected / Deactivated are sibling routes under the pathless `routes/members._tabs.tsx`, each with its own search schema.
- **`/my/*`**: `my.tsx` is the auth boundary (`requireApproved` + `requireEnabledPages(matches)`); children don't re-gate. Bare `/my` redirects to `/my/profile`. The pathless `my._tabs.tsx` holds the greeting and tabs over `/my/profile`, `/my/details` (legal name, phone, the email manager), `/my/contacts`, `/my/waiver`, `/my/security` (passkeys), `/my/preferences`. `/my/gear`, `/my/gear/cart`, `/my/feedback` and future `/my/dashboard` / `/my/trips` are direct siblings outside the tab chrome. There is no `/account` segment.

## Rules that are easy to break

**Session and principal**

- **`sessions.id` is `hashToken(cookie)`, never the cookie value** (#375), the same as `magic_links.token_hash`. Anything that looks a session up by the cookie, or compares a row to "this session", hashes first through `bearer-token.server.ts`; a new bearer credential stored in D1 uses the same helpers.
- **The whole principal is serialized to its own browser.** Anything added to it is visible to that user; never another user's data or a secret.
- **`preferredName` is what the account chrome shows** (`UserMenu`, avatar initials), falling back to the email. `loadPrincipal` normalises a blank `preferred_name` to `null`.
- **Every email insert and lookup goes through `email-normalize.ts`** (`trim().toLowerCase()`). Race safety relies on the UNIQUE constraint via `isUniqueViolation()`.
- **Adding an email is a magic-link round-trip (`intent = "add_email"`)**, and `/verify-email` asserts `session.userId === magicLink.target_user_id`. Promotion is a `db.batch` swap. Removing the primary or the last email is blocked.
- **`requestMagicLinkAction` pads to ≥500 ms plus 0–300 ms jitter.** Only that publicly enumerable endpoint gets jitter.
- **Turnstile**: the widget is gated on `VITE_TURNSTILE_SITE_KEY`; server verification fails open when `TURNSTILE_SECRET_KEY` is unset.

**Registration**

- **`/register/profile` accepts a proof cookie (no `users` row yet) or a session (no `profiles` row)**; `requireRegistrationContext` exposes `{ source, email }`. It collects only what an exec needs to review: legal + preferred name, phone, UC affiliation, policies ack.
- **Optional parts live on `/register/pending`** (`PasskeyEnrollmentCard`, `ContactsEditor`, `BioEditor`), whose writes need a session but not approval. It redirects an approved principal to its `?redirect` or `/my/profile`, and a profile-less one back to `/register/profile`.
- **Officer pre-add ("unclaimed")**: `members:manage` officers add by name + email (`status="unclaimed"`, `placeholder_name`, `unclaimed_at`, primary email with `verified_at = NULL`). The first magic-link click approves on profile submit, skipping the queue. Audit chain `member.pre_added` → `member.claimed`. Excluded from the directory and from role assignment.

**Return path (`?redirect=`)**

- **Account-status guards take the `beforeLoad` args object** (`requireApproved({ context, location })`), never a bare `QueryClient`, so a route can't forget the location.
- **The value is `pathname + searchStr`**, never the hash (`beforeLoad` doesn't see it during SSR).
- **`/register/pending` and `/deactivated` call `requireAuth` themselves**, which is why neither may be a return path.
- **`signInReturnPath` returns nothing inside the sign-in flow** (`/sign-in`, `/auth/`, `/register/`, `/verify-email`) or for `/deactivated`.
- **Every hop re-checks with `safeReturnPath`**: one leading `/` not followed by `/` or `\`, no control characters, length-capped. Never a bare `startsWith("/")`. Its property test requires the origin unchanged.
- **Navigate with `navigate({ href })`, never `{ to }`**, so the search string survives.
- **The path is carried through `/register/profile` to `/register/pending` and stops there**, offered as a link; a claimed pre-add goes straight to it.

**RBAC**

- **Adding a permission needs a migration.** Roles and grants are editable at `/access`; the catalog isn't.
- **No permission implication.** Where a write implies a read (`waivers:verify` → `waivers:view`, `gear:manage` → `gear:inspect`), the OR lives in one shared helper per pair (`requireWaiverViewer`, `requireGearInspector`, `requireAnyPermission` for route guards), never `includes() || includes()` at call sites, and the seed grants the read explicitly.
- **`roles.displayName` is the only half that reaches the screen; `roles.name` is a slug.** Never prettify a slug, and no `capitalize` class on badges. Rows carry `MemberRoleBadge = { name, displayName }`; the principal's `roleDisplayNames` is filled beside `rolePermissionMap` in both branches of `loadPrincipal`.
- **Non-officers never see the `/members` tab bar** (`MembersTabsBar` returns `null` without `members:manage`), and each management route stacks `requirePermissionOrNotFound("members:manage")`.
- **`/my/feedback` 404s without either `*_feedback:submit`** (`canReachMyFeedback`).

**Forms**

- **`/my/details` and `/my/contacts` both write through `submitDetailsFn`** with the whole `detailsInputSchema`. Each page passes the other's fields through unchanged, or saving one blanks the other.

## Adding things

- **A permission**: a migration (row + seed grants), plus a shared helper and constant in `guards.ts` if it pairs with another. Only `anonymous_grantable` permissions may go on `anonymous` (`emulation.md`).
- **A gated route**: guards take `{ context, location }`; a `/my` child needs no auth guard of its own.
- **A field on the principal**: assume the user can read it.
