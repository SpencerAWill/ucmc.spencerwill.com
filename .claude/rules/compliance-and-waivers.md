---
paths:
  - "apps/ucmc-web/src/config/legal.ts"
  - "apps/ucmc-web/src/config/waiver-cycle.ts"
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

## Legal copy is not word-smithing

**`src/config/legal.ts`** is the source of truth for every legal/policy string the site renders, plus `WAIVER_PDF_PATH`, `WAIVER_VERSION`, `POLICIES_VERSION`.

**Site copy must match the canonical PDF byte-for-byte.** Treat copy edits to `/disclaimer`, `/nondiscrimination`, `/anti-hazing`, `/waiver`, `/privacy`, `/terms`, `/about`, `/membership`, `/legal`, `/open-source` as **legal review, not word-smithing** — raise them with the user rather than tidying prose.

The registration disclaimer (UC Rule 40-03-01) uses an inline-style font to survive Tailwind purging.

The **compliance matrix** in the [GitHub wiki](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki/Compliance) maps each obligation (Ohio law, UC trademark, FERPA, Clery, EIT 9.2.1, bylaws) to the file/route satisfying it. The wiki is edited on GitHub and is not checked out into this repo — **update it when adding compliance-shaped features.**

## Versions

**Bumping `WAIVER_VERSION` invalidates every existing attestation** — `requireCurrentWaiver` filters on `(userId, cycle, version)` together, so non-revoked is not enough. `POLICIES_VERSION` is informational; no guard re-prompts on it.

## The "current attestation" predicate has exactly one home

**`src/server/waivers/current-attestation.server.ts`** (`currentAttestationFilter` / `currentlyAttestedUserIds` / `hasCurrentAttestation` / `loadMemberWaiverStatus`). It lives in `src/server/` rather than `features/waivers/` for the same reason the audit _recorder_ does: three features ask the question (`features/waivers` owns the queue + attest flow, `features/gear`'s `requireCartMember` refuses carts from lapsed members, `features/members` renders waiver standing on the detail page) but only one owns the read-side UI, and `import/no-restricted-paths` forbids features importing each other. `features/gear` had hand-rolled its own copy of the three-condition WHERE until it was consolidated.

**Never re-derive `(cycle, version, revokedAt IS NULL)` inline** — the next `WAIVER_VERSION` bump is where the copies silently disagree.

The cycle itself comes from `currentWaiverCycle()` — see the dates rule; never compute the August boundary ad-hoc.

## Two waiver permission tiers

- **`waivers:view`** is read-only — the `/members/waivers` queue, another member's attestation history, and the waiver card on `/members/$publicId`. Seeded to president, treasurer, and advisor, since exec who need to answer "is this member covered?" shouldn't need the attestation power to do it.
- **`waivers:verify`** additionally attests, bulk-attests, and revokes.

There is no permission-implication mechanism, so `verify` implies `view` via an OR check in exactly two places — `requireWaiverViewer` (server) and `requireAnyPermission(queryClient, [...])` on the route guard — and the seed migration grants `waivers:view` explicitly to the verify-holding roles so `/access` shows the real grant rather than an invisible implication. **`WAIVER_VIEW_PERMISSIONS`** (`features/auth/guards.ts`) names the pair once for the server helper, the route guard, the sidebar entry, and that card.

Handing out the read tier broadly is deliberately low-risk: **no signed PDF is ever stored**, so an attestation row is just `(userId, cycle, version, attestedAt, attestedBy)`.

## Attestation is officer-driven, which constrains where it can gate

A member cannot self-serve an attestation. So a surface that merely _benefits_ from current standing should call `getCurrentWaiverStatus` for an advisory banner rather than `requireCurrentWaiver` — redirecting to `/my/waiver` strands someone who has already handed in their signed paper and is waiting on the Treasurer. `/trips` is the standing example.
