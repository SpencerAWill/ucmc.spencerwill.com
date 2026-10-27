---
paths:
  - "apps/ucmc-web/src/config/legal.ts"
  - "apps/ucmc-web/src/config/club-season.ts"
  - "apps/ucmc-web/src/server/waivers/**"
  - "apps/ucmc-web/src/features/waivers/**"
  - "apps/ucmc-web/src/routes/waiver.tsx"
  - "apps/ucmc-web/src/routes/privacy.tsx"
  - "apps/ucmc-web/src/routes/terms.tsx"
  - "apps/ucmc-web/src/routes/legal.tsx"
  - "apps/ucmc-web/src/routes/disclaimer.tsx"
  - "apps/ucmc-web/src/routes/nondiscrimination.tsx"
  - "apps/ucmc-web/src/routes/anti-hazing.tsx"
  - "apps/ucmc-web/src/routes/membership.tsx"
  - "apps/ucmc-web/src/routes/about.tsx"
  - "apps/ucmc-web/src/routes/constitution.tsx"
  - "apps/ucmc-web/src/routes/open-source.tsx"
---

# Compliance, legal copy, and waivers

Why the waiver term is the club season: `docs/adr/0004-the-club-season-is-the-waiver-term.md`. This file is the rules for changing legal copy and waivers.

## Where things go

- **`src/config/legal.ts`** is the source of truth for every legal/policy string the site renders, plus `WAIVER_PDF_PATH`, `WAIVER_VERSION`, `POLICIES_VERSION`.
- **`src/server/waivers/current-attestation.server.ts`** is the one home of the "current attestation" predicate (`currentAttestationFilter` / `currentlyAttestedUserIds` / `hasCurrentAttestation` / `loadMemberWaiverStatus`). It is in `src/server/`, not `features/waivers/`, because `features/waivers` (queue + attest flow), `features/gear` (`requireCartMember`) and `features/members` (the detail page's standing) all ask the question.
- **`WAIVER_VIEW_PERMISSIONS`** (`features/auth/guards.ts`) names the view/verify pair once, for `requireWaiverViewer`, the route guard, the sidebar entry and the member-detail card.
- **The compliance matrix** is in the [GitHub wiki](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki/Compliance), mapping each obligation (Ohio law, UC trademark, FERPA, Clery, EIT 9.2.1, bylaws) to the file or route satisfying it. It is not checked out here.

## Rules that are easy to break

- **Site copy must match the canonical PDF byte-for-byte.** Copy edits to `/disclaimer`, `/nondiscrimination`, `/anti-hazing`, `/waiver`, `/privacy`, `/terms`, `/about`, `/membership`, `/legal`, `/open-source` are **legal review, not word-smithing**: raise them with the user rather than tidying prose.
- **The registration disclaimer (UC Rule 40-03-01) uses an inline-style font** so Tailwind purging can't drop it.
- **Bumping `WAIVER_VERSION` invalidates every existing attestation**: `requireCurrentWaiver` filters on `(userId, cycle, version)` together. `POLICIES_VERSION` is informational; no guard re-prompts on it.
- **Never re-derive `(cycle, version, revokedAt IS NULL)` inline.** Import the predicate; copies disagree at the next version bump (`features/gear` had one until it was consolidated).
- **The cycle is `currentSeason()`**, never an ad-hoc August boundary, with no grace window. `attestWaiver` stamps the season at attest time, so a mid-season waiver covers the whole season.
- **`waivers:view` is read-only** (queue, history, the member-detail card; seeded to president, treasurer, advisor). **`waivers:verify`** also attests, bulk-attests and revokes. `verify` implies `view` only through the OR in `requireWaiverViewer` and the route's `requireAnyPermission`, and the seed grants `view` explicitly to verify-holders so `/access` shows the real grant.
- **No signed PDF is ever stored**; an attestation row is `(userId, cycle, version, attestedAt, attestedBy)`. That is what keeps the read tier low-risk; keep it that way.
- **Attestation is officer-driven**, so a member can't self-serve one. A surface that merely benefits from standing uses `getCurrentWaiverStatus` for an advisory banner, not `requireCurrentWaiver`, which would strand someone waiting on the Treasurer (`/trips` is the example).

## Adding things

- **A compliance-shaped feature** updates the wiki's compliance matrix in the same change.
- **A new surface that asks "is this member covered?"** imports from `current-attestation.server.ts`; a client gate uses `WAIVER_VIEW_PERMISSIONS`.
