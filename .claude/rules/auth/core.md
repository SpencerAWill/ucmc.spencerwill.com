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

Session, identity, permissions and the member surfaces. The rest of this rule is
split by area under `.claude/rules/auth/` and loads with the files it is about:
`passkeys.md` (WebAuthn and the three enrollment surfaces), `access.md` (the
`/access` panel and the role sheet) and `emulation.md` (role preview, the
`anonymous` floor, `hasPermission`). Read the relevant one before changing
behaviour it covers.

## Session & identity

- **Session/principal** lives in `src/server/auth/`. The principal exposes `primaryEmail: string`, `emails: string[]`, and `preferredName: string | null` — the profile's name, `null` until registration is finished. The whole principal is serialized to the client in the session payload, so anything added to it is public to that user. **`preferredName` is what the account chrome shows** (the `UserMenu` label and the avatar's initials fallback), with the email as the fallback for the pre-profile window; the email itself is on `/my/details`. A blank `preferred_name` is normalised to `null` in `loadPrincipal`, since the column is NOT NULL and an empty string would render as an empty label instead of falling back.
- **Multiple verified emails per user**: a `user_emails` table with one `is_primary = 1` row enforced by a partial unique index. `users` has no `email` column — every read joins. A global `UNIQUE(email)` means an address belongs to exactly one account; race safety relies on that constraint via `isUniqueViolation()` in `src/server/db/index.ts`. **All inserts/lookups must go through `src/server/auth/email-normalize.ts`** (`trim().toLowerCase()`). Adding an email is a magic-link round-trip with `intent = "add_email"`; `/verify-email` asserts `session.userId === magicLink.target_user_id` so a stranger can't graft an address onto another account. Promotion is a `db.batch` swap (SQLite enforces partial-unique at statement boundaries). Removing the primary or the last row is blocked.
- **Magic link**: `requestMagicLinkAction` pads the response to ≥500 ms + 0–300 ms jitter to flatten the registered/not-registered timing signal. Only the publicly-enumerable request endpoint gets jitter.
- **Turnstile**: the client widget is gated on `VITE_TURNSTILE_SITE_KEY`; server verification in `features/auth/server/turnstile.server.ts` fails open when `TURNSTILE_SECRET_KEY` is unset.
- **`/register/profile`** accepts a proof cookie (first-time, no `users` row yet) OR a session cookie (returning user with no `profiles` row). `requireRegistrationContext` exposes `{ source, email }`. It collects **only what an exec needs to review the account** — legal + preferred name, phone, UC affiliation, policies ack. The optional parts (emergency contacts, bio) submit empty and are offered on **`/register/pending`**, which mounts `PasskeyEnrollmentCard` + `ContactsEditor` + `BioEditor` behind their own Saves. Those write through the WebAuthn register pair / `submitDetailsFn` / `submitPublicProfileFn`, which require a session but **not** approval — that's what makes them legal before an exec acts, and why the split works without draft state. `/register/pending` redirects an approved principal to its `?redirect` or else `/my/profile` (where the same fields sit beside everything else) and a profile-less one back to `/register/profile`.
- **Officer pre-add ("unclaimed" members)**: `members:manage` officers bulk-add by name + email so off-platform records FK to a stable `users.id`. Unclaimed users have `status="unclaimed"`, `placeholder_name`, `unclaimed_at`, and a primary `user_emails` row with `verified_at = NULL`. The first magic-link click flips them to approved on profile submit, skipping the pending queue — pre-add IS the approval signal. Audit chain: `member.pre_added` → `member.claimed`. Excluded from the public directory and from RBAC role assignment.

## Return path after sign-in (`?redirect=`)

**Signing in lands back on the page that was asked for.** The account-status guards (`requireAuth`, `requireApproved`, `requireCurrentWaiver` and the permission guards built on them) take the `beforeLoad` args object — `requireApproved({ context, location })` — not a bare `QueryClient`, so a route can't forget to pass the location: it is part of the only argument. When only 3 of ~29 guard calls passed one, most gated pages signed people in to `/`. The value is `pathname + searchStr`, never the hash, which `beforeLoad` doesn't see during SSR. The header's "Sign in" link carries the current page the same way, and both go through `signInReturnPath`, which returns nothing for a page inside the sign-in flow (`/sign-in`, `/auth/`, `/register/`, `/verify-email`) or `/deactivated` — `/register/pending` and `/deactivated` call `requireAuth` themselves, and a return path to them would nest `?redirect=` inside itself or land the next person to sign in on a stale "account deactivated" page.

- **Every hop re-checks it with `safeReturnPath` (`src/lib/`)**, the one validator: a single leading `/` not followed by `/` or `\`, no control characters, length-capped. A bare `startsWith("/")` accepts `//evil.example` and `/\evil.example`, and the URL parser strips tab/CR/LF, so `/\t/evil.example` becomes `//evil.example`. Six copies of that check had existed; its property test resolves every accepted value against our origin and requires the origin unchanged.
- **Navigate to it with `navigate({ href })`, never `{ to }`**, so its search string survives. `href` does a full document navigation for any value with a scheme, which is the other reason it must pass `safeReturnPath` first.
- **The post-sign-in decision table is `postSignInHref` / `callbackHref` (`features/auth/lib/post-sign-in.ts`)**, shared by `/auth/callback`, both passkey paths and the registration form. It carries the path through `/register/profile` to `/register/pending` and stops there: approval can take days, so the pending page offers it as a link. A claimed officer pre-add (approved on submit) goes straight to it.

## Permissions are DB rows

**Adding a permission needs a migration** — unlike site settings, where a new registry entry is the whole change. Roles, and which permissions each role holds, are runtime-editable at `/access`; the permission catalog itself is not.

**There is no permission-implication mechanism.** Where a write permission should imply its read counterpart (`waivers:verify` → `waivers:view`, `gear:manage` → `gear:inspect`), the OR is expressed at the gate — one shared helper per pair (`requireWaiverViewer`, `requireGearInspector`, `requireAnyPermission` for route guards) rather than `includes() || includes()` scattered across call sites — and the seed migration additionally grants the read permission to the roles holding the write one, so `/access` shows the real grant instead of an invisible implication. Permission-pair constants live beside each other in `features/auth/guards.ts` (`WAIVER_VIEW_PERMISSIONS`, `CLUB_FEEDBACK_PERMISSIONS`, `SITE_FEEDBACK_PERMISSIONS`) because several call sites ask the same question and spelled-out copies drift.

**`roles.displayName` is the only half that may reach the screen; `roles.name` is a slug for comparison.** Directory rows and `MemberDetail` carry `MemberRoleBadge = { name, displayName }` for that reason — they used to carry bare slugs that each badge prettified with `replace("_", " ")` + CSS `capitalize`, which rendered `gear_cave_manager` as "Gear Cave_manager" (non-global replace, first underscore only). **Don't prettify a slug**: it can't recover intended casing, and `capitalize` mangles a real label ("VP of Trips" → "VP Of Trips"), so the badge markup carries no `capitalize` class. The principal carries **`roleDisplayNames`** (slug → label) keyed identically to `rolePermissionMap`, filled in both branches of `loadPrincipal` beside the permission map precisely so a previewable role can't appear in one without the other.

## Member management (`/members`)

The directory and the four management buckets share one surface. Approved is the default tab at `/members`; Pending / Unclaimed / Rejected / Deactivated are real sibling routes under a pathless `_tabs` layout (`routes/members._tabs.tsx`). Approved-only members never see the tab bar (`MembersTabsBar` returns `null` without `members:manage`); each management child route stacks `requirePermissionOrNotFound("members:manage")` so deep links by non-officers surface the notFound boundary instead of redirecting. Each tab owns its own search-param schema — no cross-tab filter carryover.

## Personal namespace (`/my/*`)

`my.tsx` is the auth boundary for everything personal — it runs `requireApproved` once plus the `requireEnabledPages(matches)` walk, so no child re-gates auth. Bare `/my` redirects to `/my/profile`.

The account surface is a **pathless `my._tabs.tsx` layout** holding the "Hi {preferred name}!" greeting and the tab bar over six sibling routes: `/my/profile`, `/my/details` (legal name, phone, **and the verified-email manager**), `/my/contacts`, `/my/waiver`, `/my/security` (passkeys), `/my/preferences`. It's pathless so the greeting and tabs don't leak into `/my/gear`, `/my/gear/cart`, or the planned `/my/dashboard` + `/my/trips`, which are direct siblings that opt out of the chrome. **There is no `/account` URL segment** — the tab group is defined by the layout file, not the URL.

**`/my/details` and `/my/contacts` both write through the one `submitDetailsFn`**, which takes the whole `detailsInputSchema` shape — **each page must pass the other's fields through unchanged from the loaded profile**, or saving from one blanks the other's columns. Emails live on Details rather than Security because they're contact details as much as magic-link targets, which leaves Security to passkeys alone.
