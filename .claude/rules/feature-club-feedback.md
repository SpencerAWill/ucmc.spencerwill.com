---
paths:
  - "apps/ucmc-web/src/features/club-feedback/**"
  - "apps/ucmc-web/src/routes/feedback.club.tsx"
---

# Club feedback (`/feedback/club`)

Suggestion / concern / praise / general submissions aimed at the exec board for club governance. A separate `club_feedback` table and separate `club_feedback:submit` / `club_feedback:manage` permissions (`role_member` auto-granted submit). Members send it from the user-menu dialog and see their own on `/my/feedback`; `/feedback/club` is the officers' list, gated by `club_feedback:manage` and `pages.feedback_club`. The managers' index, the dialog and `/my/feedback` are in `feedback-index.md`.

**It has no GitHub path and no triage inbox.** Club feedback is governance-internal and must never reach a public issue tracker. Officers review it on `/feedback/club` (the index card's button reads "Review"), changing a row's status with `useUpdateClubFeedbackStatus`. `getClubFeedbackOverview()` returns counts only (`mineOpen`, and `newForOfficers` for managers); the index card shows `newForOfficers`.

**Opt-in anonymous toggle**: the server still records `createdBy` for per-user rate limiting and abuse handling, but `anonymous = 1` causes the actions layer to strip submitter columns (`createdBy`, `createdByPublicId`, joined name/avatar) from manager-facing projections. **The wire payload itself carries no identity.** Owners always see their own row un-redacted.

Submissions are gated by the `club_feedback.submissions_enabled` **feature** setting (default ON). **Toggling it off blocks new submissions only**; managers keep access through `club_feedback:manage`. That is why it is a `features.*` setting and not a page flag; see `site-settings.md`.
