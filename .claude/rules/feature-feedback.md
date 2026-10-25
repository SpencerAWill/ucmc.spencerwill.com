---
paths:
  - "apps/ucmc-web/src/features/site-feedback/**"
  - "apps/ucmc-web/src/features/club-feedback/**"
  - "apps/ucmc-web/src/routes/feedback.*"
  - "apps/ucmc-web/src/components/feedback/**"
---

# Feedback (`/feedback/*`)

Two surfaces, `/feedback/club` and `/feedback/site`, hang off a `/feedback` layout (`feedback.tsx`: page chrome, a breadcrumb hidden on the index, `requireEnabledPages` for the master `pages.feedback` switch, then `requireApproved`).

**`/feedback` is an index page of cards** (`feedback.index.tsx`), one per surface the viewer can reach, club first because it reaches the exec board. Reachability is permission AND `pages.*` flag aware, and the index 404s only when neither surface is reachable. The route computes plain props (reachability, `hasPermission(...:manage)`, the overview counts from `siteFeedbackOverviewQueryOptions` / `clubFeedbackOverviewQueryOptions`) and hands them to `FeedbackIndexCards` in `src/components/feedback/`, which holds no hooks so a test can pin the one rule that matters: **manager badges and the Review link follow the `canManage*` boolean, never the presence of a count in the payload** (the server answers the real principal, so under role emulation the payload still carries a manager count). A badge whose count is 0 is omitted.

Each surface route 404s when the viewer can't reach it; there are no sibling redirects, because the index only links to surfaces the viewer holds. Each surface page owns its `<h1>` and subtitle. The sidebar links to `/feedback`, gated on `pages.feedback` AND (site reachable OR club reachable).

## Site surface (`/feedback/site`)

Bug / feature / general submissions aimed at site maintainers. Permissions are `site_feedback:submit` / `site_feedback:manage` (`role_member` auto-granted submit), renamed from the unprefixed `feedback:*` so they read as siblings of `club_feedback:*`. Gated by `pages.feedback_site`.

## Club surface (`/feedback/club`)

Suggestion / concern / praise / general submissions aimed at the exec board for club governance. Separate `club_feedback` table, separate `club_feedback:submit` / `club_feedback:manage` permissions (`role_member` auto-granted submit).

**Opt-in anonymous toggle**: the server still records `createdBy` for per-user rate limiting and abuse handling, but `anonymous = 1` causes the actions layer to strip submitter columns (`createdBy`, `createdByPublicId`, joined name/avatar) from manager-facing projections — **the wire payload itself carries no identity.** Owners always see their own row un-redacted.

## Shared

Each surface is independently gated by the `site_feedback.submissions_enabled` / `club_feedback.submissions_enabled` **feature** settings (both default ON). **Toggling off blocks new submissions only**; managers retain triage access via the separate `*:manage` permission. That's why these are `features.*` and not page flags — see the settings rule.

**`CLUB_FEEDBACK_PERMISSIONS` / `SITE_FEEDBACK_PERMISSIONS`** (`features/auth/guards.ts`) name the surface pairs once — four places ask the question (sidebar entry, the index, two surface routes), and the club/site split out of a single `feedback:*` is the kind of change that makes spelled-out copies drift. The index picks between two surfaces rather than gating on one permission, so it can't use `requirePermission` and must read `effectivePermissionsFor` — a hand-rolled `principal.permissions.includes()` bypasses role emulation silently.
