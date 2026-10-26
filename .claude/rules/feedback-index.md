---
paths:
  - "apps/ucmc-web/src/routes/feedback.tsx"
  - "apps/ucmc-web/src/routes/feedback.index.tsx"
  - "apps/ucmc-web/src/components/feedback/**"
  - "apps/ucmc-web/src/components/layouts/feedback-dialog.tsx"
  - "apps/ucmc-web/src/routes/my.feedback.tsx"
---

# Feedback index (`/feedback`)

**`/feedback` is the managers' area.** Site maintainers (`site_feedback:manage`) triage site feedback; the exec board (`club_feedback:manage`) reviews club feedback. Members never use it: they send feedback from the user menu ("Send Feedback", a dialog on every page) and follow it up on `/my/feedback`. The surfaces have their own rules: `feature-club-feedback.md` and `feature-site-feedback.md`. The URL area, `pages.feedback`, the layout and the index keep the bare name "feedback" because they span both surfaces; everything that belongs to one surface says which.

**The layout (`feedback.tsx`) decides who gets in** with `feedbackAreaDecision(granted, pages.my_feedback)` from `features/auth/guards.ts`, fed **effective** permissions: a manager of either surface is allowed, anyone else is redirected to `/my/feedback`, or gets the 404 when that page is off. It runs after `requireEnabledPages` (the master `pages.feedback` switch) and `requireApproved`. `FEEDBACK_MANAGE_PERMISSIONS` names the two manage permissions once.

**`/feedback` is an index of cards** (`feedback.index.tsx`), one per surface the viewer manages whose `pages.*` flag is on, club first because it reaches the exec board; it 404s when none is. The route computes plain props (reachability from `hasPermission(...:manage)` and the flag, counts from `siteFeedbackOverviewQueryOptions` / `clubFeedbackOverviewQueryOptions`) and hands them to `FeedbackIndexCards` in `src/components/feedback/`, which holds no hooks. **A count renders only on a reachable card, never because the payload carries it**: the server answers the real principal, so under role emulation the payload still has manager counts. A badge whose count is 0 is omitted. The club card's button is "Review" (`/feedback/club`), the site card's "Triage" (`/feedback/site/triage`).

`/feedback/site` redirects to `/feedback/site/triage`; `/feedback/club` is the officer list and 404s (`requirePermissionOrNotFound`) for a site-only manager. The sidebar links to `/feedback`, gated on `pages.feedback` AND (manages site with `pages.feedback_site` on OR manages club with `pages.feedback_club` on).

## The dialog and `/my/feedback`

- **`src/components/feedback/feedback-launcher.tsx`** is a feature-blind context: `useFeedbackLauncher()` gives triggers `{ canSend, open }`; `open()` waits a frame (so the menu closes), records `pageUrl`, `userAgent` and, when enabled, a screenshot from an injected `capture`, then opens. A capture that rejects opens without a screenshot.
- **`src/components/layouts/feedback-dialog.tsx`** composes both features, so it lives in `layouts/`, which may. `AppLayout` provides the launcher and mounts the dialog once. `useFeedbackSurfaces()` offers a surface when the viewer is approved, holds its submit permission and its `*.submissions_enabled` setting is on. With both, the dialog opens on a chooser; with one, straight on its form, with Back between them. The recorded context is held until the dialog closes, so Club → Back → Site keeps the screenshot. **Only the site form receives it**; club feedback can be anonymous and carries nothing about the browser.
- The user menu has two separate entries: "My Feedback" sits with the other "My" pages (when `pages.my_feedback` and either submit permission), and "Send Feedback" is a section of its own, behind a separator, above Sign out (when `canSend`). They used to share one side-by-side row, which wrapped both labels onto two lines at the menu's width.
- **`/my/feedback`** (`routes/my.feedback.tsx`) lists the viewer's own site and club feedback in "Website" and "Club" sections, each shown only with its submit permission; it 404s without either (`canReachMyFeedback`).

The two features must not import each other, so anything both need lives in `src/components/feedback/`, `src/components/layouts/` or `src/server/`.
