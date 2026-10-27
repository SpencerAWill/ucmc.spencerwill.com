---
paths:
  - "apps/ucmc-web/src/server/member-profile/**"
  - "apps/ucmc-web/src/features/members/components/profile/**"
  - "apps/ucmc-web/src/features/members/lib/topo-banner.ts"
  - "apps/ucmc-web/src/components/badge-emblem.tsx"
  - "apps/ucmc-web/src/routes/members.$publicId.tsx"
  # The editing surfaces. The "Editing" rules below warn about adding a
  # field to `profileInputSchema` without carrying it through every form,
  # so the rule has to load for the person editing those files, not only
  # for the profile page that suffers the consequence.
  - "apps/ucmc-web/src/server/profile/profile-schemas.ts"
  - "apps/ucmc-web/src/components/profile/**"
  - "apps/ucmc-web/src/features/members/components/admin-profile-sheet.tsx"
  - "apps/ucmc-web/src/features/auth/components/profile-facets-editor.tsx"
  - "apps/ucmc-web/src/features/auth/server/profile-facets-actions.server.ts"
  - "apps/ucmc-web/src/routes/my._tabs.profile.tsx"
---

# Member profiles, seasons, and badges

`/members/$publicId` (#257) leads with the person; everything an officer needs sits behind an **Officer tab**. That split is the feature; keep it. Why prompts and badges are registries and badges are never stored: `docs/adr/0010-registries-not-rows.md`. Why a season is the unit: `docs/adr/0004-the-club-season-is-the-waiver-term.md`. This file is the rules for changing profiles.

## Where things go

`src/server/member-profile/`, not `features/members`: it reads across waivers, gear and roles, and features can't import each other.

| Module                       | Holds                                               |
| ---------------------------- | --------------------------------------------------- |
| `profile-prompt-registry.ts` | Prompt catalog, discipline catalog, level scale     |
| `badge-registry.ts`          | Badge catalog: label, kind, artwork, shape, blocker |
| `badge-rules.ts`             | **Pure.** Thresholds and who earns what             |
| `season-progress.ts`         | **Pure.** The May 1 boundary and the arc fraction   |
| `member-stats.server.ts`     | Every SQL question; no policy                       |
| `profile-facets.server.ts`   | Reads the two sparse profile tables                 |

- **Answers** are sparse rows in `profile_prompts` and `profile_disciplines`.
- **Badge art** is a file under `public/badges/`, named by `BADGES[key].art`, masked to the badge's shape by `BadgeEmblem`. `resolveBadgeArt` is the single seam for any future officer-uploaded override. The Storybook `Catalog` story renders every badge at member size in both themes.
- **`/my/profile`** carries two independent forms: the profile form (`submitPublicProfileFn`, columns on `profiles`) and the facets editor (`submitProfileFacetsFn`, the two sparse tables, replace-all in one batch).

## Rules that are easy to break

- **All SQL in `member-stats.server.ts`, all policy in `badge-rules.ts` / `season-progress.ts`.** A threshold inlined into an action can't be mutation-tested. Both pure modules are in `stryker.config.json`.
- **`loadProfileFacets` drops rows whose key has left the registry.** Retiring a prompt is deleting its entry; never chase orphaned answers with a migration.
- **Badges are computed on every read.** No grant table.
- **A `blockedBy` badge is never awarded.** `badge-rules.test.ts` enforces it by running `awardedBadges` with every counter maxed; don't add a runtime guard (unreachable, and mutation testing says so).
- **Badge art is a repo file, not an upload.** `badge-emblem.test.tsx` walks the real directory, so a renamed file fails a test.
- **Shape carries kind**: round is a season, a shield is service, a hex is something you went out and did.
- **Rings** (each has a test):
  1. **A first-year member has no closed ring**, only the arc.
  2. **A season closes on May 1**; `seasonComplete` and `seasonProgress` divide by the same boundary, so a ring closes as its arc fills. May–August shows a closed ring and no arc.
  3. **The arc starts the day that member first attested** (`MIN(attested_at)` per cycle), not the day the cycle opened; revoke-and-reattest doesn't reset it.
- **The tenure badge keys off the same `completedSeasons` as the rings.** There is no track behind the arc.
- **Tenure counts distinct attested cycles, not filtered on waiver `version`.**
- **`profile_disciplines` is self-rated and authorizes nothing**; keep the "Self-rated" label. Certificates that gate gear (#257 phase 2) are a separate table with a granting officer and an audit trail.
- **`trail_name`, `pronouns`, `status_line` are stored as NULL when empty.**
- **Both facet deletes are unconditional**, which is what makes "clear everything" work.
- **Anything added to `profileInputSchema` is carried by every form that builds `ProfileFormShape`, the admin sheet included**: `adminUpdateProfileAction` writes every column, so a field the sheet lacks is blanked on the next officer save. `withForm`'s invariant generics make it a compile error; don't loosen them.
- **The banner is full-bleed by sitting outside `PageContainer`**, never by a negative margin.
- **`/members/$publicId` stays in `reflow-pages.spec.ts`** with its hostile fixture data (unbreakable long name, long single-token email, over-long status line).
- **The field emergency card is scoped to `members:view_private`.** Its copy says who can actually see it; **don't reword it to promise trip-scoping that isn't there.**

## Adding things

- **A prompt, discipline or badge** is an entry in its registry: no migration.
- **A badge needing data we don't have** is declared with `blockedBy`.
- **An officer-awarded superlative** (#257 phase 4) is the one badge shape that would need a table; none is declared yet.
- **A new pure profile module** is added to `stryker.config.json`'s `mutate` list.
- **Medical notes** need a consent model, per-view logging and a compliance-wiki update; they are their own piece of work, not a field on this form.

## Not built yet

- **Trip-dependent badges** (Underground, First Rope, Polar Bear, …) are declared and blocked; trips are still a Google Form embed.
- **Trip-scoped emergency card access** needs trip rosters.
