---
paths:
  - "apps/ucmc-web/src/server/member-profile/**"
  - "apps/ucmc-web/src/features/members/components/profile/**"
  - "apps/ucmc-web/src/features/members/lib/topo-banner.ts"
  - "apps/ucmc-web/src/components/badge-emblem.tsx"
  - "apps/ucmc-web/src/routes/members.$publicId.tsx"
---

# Member profiles, seasons, and badges

The redesign of `/members/$publicId` (issue #257). The page used to
open on waiver standing, emergency contacts and admin buttons — it
read as a personnel record because that is what it was. It now leads
with the person, and everything an officer needs sits behind an
**Officer tab**. That split is the feature; keep it.

## Where the pieces live, and why they are not in `features/members`

`src/server/member-profile/` holds everything the profile computes,
because it reads across waivers, gear and roles and **features can't
import each other** — the same route `gear-cave-standing.server.ts`
and `current-attestation.server.ts` took.

| Module                       | Holds                                               |
| ---------------------------- | --------------------------------------------------- |
| `profile-prompt-registry.ts` | Prompt catalog, discipline catalog, level scale     |
| `badge-registry.ts`          | Badge catalog: label, kind, artwork, shape, blocker |
| `badge-rules.ts`             | **Pure.** Thresholds and who earns what             |
| `season-progress.ts`         | **Pure.** The May 1 boundary and the arc fraction   |
| `member-stats.server.ts`     | Every SQL question; no policy                       |
| `profile-facets.server.ts`   | Reads the two sparse profile tables                 |

**The split between `member-stats.server.ts` and `badge-rules.ts` is
load-bearing.** All SQL on one side, all policy on the other, which
is what keeps the thresholds in a module Stryker can mutate — a
threshold inlined into an action is not mutation-testable, and an
off-by-one in one is exactly what a surviving mutant catches. Both
pure modules are in `stryker.config.json`; **add any new pure profile
module there too.**

## Three registries, no migrations

Prompts, disciplines and badges are all **code entries, not rows** —
the same trade `site_settings` and `user_notification_preferences`
already make. Adding a prompt, a discipline or a badge is an entry in
a TypeScript file. Only the _answers_ are rows, and they are sparse:
`profile_prompts` and `profile_disciplines` hold nothing for a member
who has set nothing.

`loadProfileFacets` **drops rows whose key has left the registry**
rather than rendering them. Retiring a prompt is deleting its entry;
the orphaned answers stay on disk, so putting the prompt back brings
them back, and nothing has to chase them down with a migration.

## Badges are computed, never stored

Every badge is derived on each read from rows the app already writes
— attested waiver cycles, gear loans, sweep entries, roles. There is
no grant table, so an award and the evidence for it cannot disagree:
revoke a waiver and the badge goes with it in the same breath.

**A badge the registry marks `blockedBy` is never awarded.** Those
are the ones needing trip attendance, which does not exist yet; they
are declared so the catalog can show what is coming. The rule is
enforced by `badge-rules.test.ts`, which runs `awardedBadges` with
every counter maxed and asserts nothing blocked comes out — **not**
by a runtime guard, which could never fire and which mutation
testing duly reported as unreachable.

The one badge shape that _will_ need a table is the officer-awarded
superlative (#257 phase 4). Nothing of that kind is declared yet.

### Badge artwork is a file, not a glyph

`BADGES[key].art` names a file under `public/badges/`, and
`BadgeEmblem` masks it to the badge's shape. **Swapping in better art
is a commit, not a code change** — which is why these are repo files
rather than uploads: badge art is club identity and wants review,
history and rollback. `resolveBadgeArt` is the single seam if
officer-uploaded overrides are ever wanted.

The art shipped today is placeholder-quality and meant to be
replaced. The Storybook `Catalog` story renders every badge at the
size members see, in both themes — look at a new file there.
`badge-emblem.test.tsx` walks the real directory, because a renamed
file is otherwise a silently broken image rather than an error.

Shape carries the badge's **kind**: round is a season, a shield is
service, a hex is something you went out and did.

## Seasons: what a ring means

A ring is a season **served**. Read the avatar like a cross-cut
trunk, except that it grows outward: the first season sits against
the photo and each one after it pushes further out, with the
in-progress season as an arc beyond the lot.

Three rules, and all three have a test:

1. **A first-year member has no closed ring** — only the arc. The
   ring appears when the season is finished, not when they join.
2. **A season closes on May 1**, when the spring semester ends — not
   at the August waiver rollover that nobody is around for.
   `seasonComplete` and `seasonProgress` divide by the same boundary,
   so a ring closes at the same instant its arc fills. Between May 1
   and August a member has a closed ring and no arc, which is the
   honest picture.
3. **The arc starts the day that member attested**, not the day the
   cycle opened. Someone who joined in January is zero of the way
   into _their_ season rather than a third of the way into the
   club's. A revoke-and-reattest does not reset it — the loader takes
   `MIN(attested_at)` per cycle.

**The tenure badge keys off the same `completedSeasons` the rings
show**, so the two can never tell a member different numbers. There
is no track behind the arc: a full grey circle reads as a closed ring
they have not earned.

Tenure counts distinct attested cycles and is deliberately **not**
filtered on waiver `version` — the current-waiver guard cares which
PDF was signed, but a version bump must not retroactively erase a
year someone was around.

## Self-rated is not certified

`profile_disciplines` holds **self-rated** experience and authorizes
nothing. The UI labels it "Self-rated" and that label is not
decoration. The certificates that will gate lead and trad gear
checkout (#257 phase 2) are a different table with a granting officer
and an audit trail; keeping them apart is what stops a member
self-rating their way into the trad rack.

## Editing

`/my/profile` carries two independent forms:

- The **profile form** writes columns on `profiles` through
  `submitPublicProfileFn` — including `trail_name`, `pronouns` and
  `status_line`, which are **stored as NULL when empty** so the header
  omits the line instead of rendering a gap.
- The **facets editor** writes the two sparse tables through
  `submitProfileFacetsFn`, replace-all in one batch. Both deletes are
  unconditional, which is what makes "clear everything" work.

**Anything added to `profileInputSchema` must be carried by every
form that builds `ProfileFormShape`**, the admin sheet included —
`adminUpdateProfileAction` writes every profile column, so a field
the sheet does not carry is blanked the next time an officer saves.
`withForm`'s invariant generics make that a compile error rather than
a silent data loss, which is the coupling working as designed. This
is the same hazard `/my/details` and `/my/contacts` have with each
other.

## Mobile

The banner is full-bleed by sitting **outside** `PageContainer`, not
by a negative margin that would have to track the gutter at every
breakpoint. `/members/$publicId` is in `mobile-overflow.spec.ts` with
deliberately hostile fixture data — an unbreakable long name, a long
single-token email, an over-long status line — because it is the
first page built around free text a member types about themselves.

## Not built yet, and why

- **Trip-dependent badges** (Underground, First Rope, Polar Bear, …)
  are declared and blocked. Trips are still a Google Form embed.
- **The field emergency card is scoped to `members:view_private`**,
  not to the leaders of a trip the member is on for the duration of
  that trip. That narrower scope needs trip rosters. The card's copy
  says who can actually see it rather than implying the tighter
  scope; **do not reword it to promise trip-scoping that isn't there.**
- **No member-supplied medical notes.** Storing those needs a consent
  model, per-view logging and a compliance-wiki update, and is its
  own piece of work rather than a field on this form.
