---
paths:
  - "apps/ucmc-web/src/routes/feedback.tsx"
  - "apps/ucmc-web/src/routes/feedback.index.tsx"
  - "apps/ucmc-web/src/components/feedback/**"
---

# Feedback index (`/feedback`)

Two surfaces, `/feedback/club` and `/feedback/site`, hang off a `/feedback` layout (`feedback.tsx`: page chrome, a breadcrumb hidden on the index, `requireEnabledPages` for the master `pages.feedback` switch, then `requireApproved`). The surfaces have their own rules: `feature-club-feedback.md` and `feature-site-feedback.md`. The URL area, `pages.feedback`, the layout and the index keep the bare name "feedback" because they span both surfaces; everything that belongs to one surface says which.

**`/feedback` is an index page of cards** (`feedback.index.tsx`), one per surface the viewer can reach, club first because it reaches the exec board. Reachability is permission AND `pages.*` flag aware, and the index 404s only when neither surface is reachable. The route computes plain props (reachability, `hasPermission(...:manage)`, the overview counts from `siteFeedbackOverviewQueryOptions` / `clubFeedbackOverviewQueryOptions`) and hands them to `FeedbackIndexCards` in `src/components/feedback/`, which holds no hooks so a test can pin the one rule that matters: **manager badges and the Triage / Review link follow the `canManage*` boolean, never the presence of a count in the payload** (the server answers the real principal, so under role emulation the payload still carries a manager count). A badge whose count is 0 is omitted.

Each surface route 404s when the viewer can't reach it; there are no sibling redirects, because the index only links to surfaces the viewer holds. Each surface page owns its `<h1>` and subtitle. The sidebar links to `/feedback`, gated on `pages.feedback` AND (site reachable OR club reachable).

**`CLUB_FEEDBACK_PERMISSIONS` / `SITE_FEEDBACK_PERMISSIONS`** (`features/auth/guards.ts`) name the surface pairs once. Four places ask the question (sidebar entry, the index, two surface routes), and a spelled-out copy is how they drift. The index picks between two surfaces rather than gating on one permission, so it can't use `requirePermission` and must read `effectivePermissionsFor`. A hand-rolled `principal.permissions.includes()` bypasses role emulation silently.

The index composes `features/site-feedback` and `features/club-feedback` itself; the two features must not import each other, so anything both need lives in `src/components/feedback/` or `src/server/`.
