---
paths:
  - "apps/ucmc-web/src/features/feedback/**"
  - "apps/ucmc-web/src/features/club-feedback/**"
  - "apps/ucmc-web/src/routes/feedback.*"
  - "apps/ucmc-web/src/routes/feedback._tabs*"
---

# Feedback (`/feedback/*`)

Two surfaces share one route under a pathless `_tabs` layout (mirrors `/members`).

**`/feedback` is a redirect, not a page** (`feedback.index.tsx`) — it has no surface of its own and sends you to `/feedback/club`, or to `/feedback/site` when the viewer has no club access. **That choice is permission-aware on purpose**: `/feedback/club` 404s without club access, so a blind redirect would strand a site-only member arriving from the sidebar or an old bookmark. Both surface routes carry the symmetric fallback (each redirects to the other when the viewer can't see it, `notFound` when they can see neither), which can't ping-pong because each only redirects toward a surface the viewer actually holds a permission for.

**Club is the first tab, the redirect target, and the sidebar entry's default target** — it reaches the exec board, so it outranks site maintenance.

## Site tab (`/feedback/site`)

Bug / feature / general submissions aimed at site maintainers. Permissions are `site_feedback:submit` / `site_feedback:manage` (`role_member` auto-granted submit), renamed from the unprefixed `feedback:*` so they read as siblings of `club_feedback:*`. Gated by `pages.feedback_site`.

Optionally mirrors to GitHub Issues when both `FEEDBACK_GITHUB_TOKEN` (fine-grained PAT, Issues r/w) and `FEEDBACK_GITHUB_REPO` are set. **The issue body uses opaque `users.publicId` only — never email or name.** Best-effort: GitHub failures don't block the D1 insert.

## Club tab (`/feedback/club`, the default)

Suggestion / concern / praise / general submissions aimed at the exec board for club governance. Separate `club_feedback` table, separate `club_feedback:submit` / `club_feedback:manage` permissions (`role_member` auto-granted submit), and it **never** mirrors to GitHub.

**Opt-in anonymous toggle**: the server still records `createdBy` for per-user rate limiting and abuse handling, but `anonymous = 1` causes the actions layer to strip submitter columns (`createdBy`, `createdByPublicId`, joined name/avatar) from manager-facing projections — **the wire payload itself carries no identity.** Owners always see their own row un-redacted.

## Shared

Each surface is independently gated by the `feedback.site_enabled` / `feedback.club_enabled` **feature** settings (both default ON). **Toggling off blocks new submissions only**; managers retain triage access via the separate `*:manage` permission. That's why these are `features.*` and not page flags — see the settings rule.

The surface switcher is a compact segmented control of real `<Link>`s sitting right-aligned on the `<h1>`'s row rather than as a full-width bar, which leaves the subtitle the full column to describe the active surface. The shared `FeedbackTabsBar` lives in `src/components/layouts/` so neither feature has to cross-import the other.

**`CLUB_FEEDBACK_PERMISSIONS` / `SITE_FEEDBACK_PERMISSIONS`** (`features/auth/guards.ts`) name the surface pairs once — five places ask the question (sidebar entry, tab bar, three routes), and the club/site split out of a single `feedback:*` is the kind of change that makes spelled-out copies drift. The three routes pick between two surfaces rather than gating on one permission, so they can't use `requirePermission` and must read `effectivePermissionsFor` — a hand-rolled `principal.permissions.includes()` bypasses role emulation silently.
