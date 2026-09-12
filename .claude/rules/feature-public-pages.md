---
paths:
  - "apps/ucmc-web/src/features/landing/**"
  - "apps/ucmc-web/src/features/album/**"
  - "apps/ucmc-web/src/features/volunteer/**"
  - "apps/ucmc-web/src/features/sponsors/**"
  - "apps/ucmc-web/src/features/trips/**"
  - "apps/ucmc-web/src/routes/index.tsx"
  - "apps/ucmc-web/src/routes/album.tsx"
  - "apps/ucmc-web/src/routes/volunteer.tsx"
  - "apps/ucmc-web/src/routes/sponsors.tsx"
  - "apps/ucmc-web/src/routes/trips.tsx"
  - "apps/ucmc-web/src/routes/history.tsx"
  - "apps/ucmc-web/src/routes/gear-cave.tsx"
  - "apps/ucmc-web/src/routes/policies.tsx"
  - "apps/ucmc-web/src/routes/resources.tsx"
  - "apps/ucmc-web/src/routes/scholarships.tsx"
  - "apps/ucmc-web/src/routes/gazette.*"
---

# Public pages: heroes, Album, Volunteer, Sponsors, Trips

## Page heroes

Every public page renders the same hero band — a gradient or auto-advancing gallery with editable overlay copy.

**`HERO_PAGES` in `features/landing/lib/hero-pages.ts` is the single registry.** The `hero.<page>.heading` / `.tagline` setting keys, the discriminated update validator, the editor's scoping, and the `hero_slides.page` values are all derived from it, so **adding a hero to a new page is one entry there** — no migration (unlike RBAC permissions, which are DB rows). Detail pages (`/gazette/$publicId`, `/members/$publicId`) deliberately have none.

**Its keys are slugs, not URL paths** (`gear_cave` is `/gear-cave`), persisted in `hero_slides.page` and embedded in setting keys, so **renaming one is a data migration** — never derive them from the route path.

**`heroHeadingKey` / `heroTaglineKey` return template-literal types (`` `hero.${TPage}.heading` ``), not `string`, and that is load-bearing:** `HERO_HEADING_KEYS` is what `updateSettingInputSchema` feeds to `z.enum` for its discriminator, so widening either return to `string` collapses the entire `z.discriminatedUnion` — every `key` starts accepting any string and per-key value typing goes with it. Runtime validation stays correct either way, which is precisely why the loss is invisible; two `@ts-expect-error` lines in `landing-actions.test.ts` fail `tsc` if the union ever collapses again.

### Layout

**Every hero is the same height** — `min-h-[420px] md:min-h-[560px]`, home included. The `size` prop controls type scale and inner padding, **not** height; the subpage variant shipped at 220/280px and read as a thin strip beside the front door's band.

Interior heroes additionally get `flex flex-col justify-center`, because their copy is much shorter than home's (no logo, no CTA pair) and a taller box doesn't move top-aligned text, it just opens dead space beneath it. **Home deliberately stays top-aligned**: its content is also shorter than the band, so centring would shift the front door's copy down ~72px.

**The hero carries the page's `<h1>`.** Each adopting page dropped the title and description out of its own `<header>`, keeping only its action button (now a right-aligned row) — so the page name appears once and there's one accessible heading. `defaultHeading` / `defaultTagline` were seeded from each page's existing shipped copy verbatim, so adopting the hero changed the layout without changing a word.

### Reads

**`LandingContent` deliberately does NOT carry hero slides.** Every page including home reads its hero through `getPageHeroAction` / `pageHeroQueryOptions`, so a `heroSlides` field on the landing bundle would be a spare D1 query per home-page load plus a second projection of the same rows that can drift from the one actually rendered.

**Every hero read is page-scoped and there is deliberately no "all slides" read** — one table holds many pages' slides, so an unscoped list would render /album's images on /policies. The `MAX(sort_order)` subquery in `insertHeroSlide` is scoped too, or a new page's first slide would sort after every home slide ever added. **The one exception is `retention.server.ts`'s orphan sweep, which must stay unscoped**: it builds the set of keys still referenced by anything, and narrowing it to one page would delete the other pages' images.

Hero writes carry `page` in their audit metadata, because `targetId` is the slide id and says nothing about which gallery changed.

### Gallery controls (`hero-carousel-controls.tsx`)

Edge arrows are mounted only for a fine pointer with more than one slide (a hover-revealed control on a touchscreen either never appears or sticks after a tap), with `focus-visible` as a second reveal trigger so keyboard users can see what they've tabbed to.

The **autoplay dial** is a clock-face wedge that doubles as the pause toggle. **Its edge always sweeps clockwise; what alternates between slides is which side of the edge is dark.** `--hero-dial` is the raw elapsed fraction on every slide, so the only colour stop sits at `dial * 360deg` and can only increase — that shared, monotonic angle _is_ the pointer. Odd slides swap the two colours around it (`transparent → stop → currentColor` instead of `currentColor → stop → transparent`), so the dark arc grows behind the pointer while filling and the arc ahead of it shrinks while emptying: two pointers a full circle apart, chasing each other. Each handoff lands on a matching value.

**Do not express this by inverting the progress value** (`1 - elapsed` on odd slides) — it matches at the handoffs identically and is therefore easy to mistake for the same thing, but it runs the edge counter-clockwise on every other slide, which reads as a bounce. That was the original implementation.

The wedge is driven by mutating a CSS custom property from a rAF loop rather than React state; the phase is a paint decision made in the gradient, so the loop has no phase dependency at all.

Pause persists under one localStorage key shared by every hero, and `prefers-reduced-motion: reduce` starts paused — **the dial is the WCAG 2.2.2 pause control for moving content, which is why it is not hidden on touch the way the arrows are.**

## Album (`/album`)

The club photo archive — a flat `album_photos` collection (no album/trip entity; each photo carries caption, credit, `takenAt`, an optional `tag`, and a **required `altText`** enforced as NOT NULL, since every tile renders an `<img>`). Photos are cropped client-side to a fixed 4:3 WebP so the grid is uniform, and the original is discarded.

**The tag filter is URL-driven (`?tag=`) and the year filter is not** — `/volunteer`'s service record links an outing to its photos, so that one filter has to be shareable and addressable. It's a **controlled prop on `PhotoGrid` rather than seeded local state**: seeding reads the URL only at mount, so navigating from `/album` to `/album?tag=X` would leave an already-mounted grid unfiltered. `ALL_VALUE` is exported because the route maps it to an _absent_ param (a Radix Select can't hold `""` as an item value, and `?tag=__all__` shouldn't leak into a shared link), and **a `?tag=` naming a tag no photo carries falls back to "All tags" rather than leaving the trigger blank** — that case is expected, not exceptional, since an outing may name a tag before any photo is uploaded under it.

Browse is gated by `public_album:view` (granted to `role_anonymous` **and** `role_member`, so revoking the anonymous grant can't lock members out) plus the `pages.album` kill switch; upload/edit/delete need `public_album:manage`.

## Volunteer (`/volunteer`)

Six bands in one column — hero, editable narrative, standing programs, "Coming up", "Our record", and a request-volunteers band — because the four readers (prospective member, current member, outside organization, officer) each stop where their answer is rather than needing four pages. Gated by `public_volunteer:view` (`role_anonymous` **and** `role_member`) plus `pages.volunteer`. **One** `public_volunteer:manage` covers the narrative, the programs and the outings.

**The narrative is read through `markdownPageQueryOptions` and deliberately NOT folded into the page bundle**: `useUpdateMarkdownPage` invalidates `["markdown-page", slug]` and nothing else, so a bundled copy keeps rendering pre-save text _and_ then seeds `EditMarkdownSheet`'s next edit, silently overwriting the save. **`/history` still has exactly this defect.**

**`volunteer_events` has no status column, and that is the design.** Upcoming vs past is derived from `starts_at`, so nothing is flipped by hand or by a cron and the two bands can't disagree about a row. The bound is **the start of today in `CLUB_TIME_ZONE`** (`startOfClubDay` in `features/volunteer/lib/day-boundary.ts`), not `now` — a trail day that began at 09:00 shouldn't drop out of "Coming up" at noon while people are still driving to it. The read action resolves it **once** and hands the same instant to both queries, so they partition the table rather than overlapping or leaving a gap at midnight.

**The archive groups by `currentWaiverCycle`, deliberately reusing the waiver helper** — see the dates rule.

**`volunteersCount` / `serviceHours` are nullable and the totals strip reports its own coverage** ("recorded for 3 of 40"). An officer logs the outing before it happens and fills the numbers in after, if ever; a bare sum would read as "this is all we did" when it means "this is all we wrote down". A recorded **zero** counts as recorded — the note is suppressed only at full or zero coverage.

**Member sign-ups are deferred**, pending the trips work, so there is no `volunteer_signups` table. Each outing's Join affordance goes to the partner org's own form (`signupUrl`) or opens a `mailto:` naming the outing; both return `null` on a blank `contact.clubEmail` so no dead `href=""` renders. The request-volunteers band is a `mailto:` too — a public unauthenticated write would need its own table, Turnstile, a rate-limit budget and a triage queue.

**The archive's per-outing "Photos" link is gated on `pages.album` and `public_album:view`, not merely on the row carrying a tag** — /album is behind both, so an ungated link sends an anonymous visitor to a `notFound()`. `ServiceRecord` takes it as a `canLinkToAlbum` prop so the component stays query-free.

`album_tag` is a **loose string match against `album_photos.tag`, not an FK**: Album tags are freeform and an outing may name one before any photo carries it.

## Sponsors (`/sponsors`)

A hero, an officer-editable intro, the sponsor grid, and a "Sponsor UCMC" band (editable pitch markdown plus a `mailto:`). Gated by `public_sponsors:view` (`role_anonymous` **and** `role_member`) plus `pages.sponsors`; `public_sponsors:manage` covers both markdown bands and the sponsor rows.

**`sponsors` is a flat, curated list — no `since` / `until` and no active-vs-past split.** Sponsorship here is a standing relationship with a few local businesses rather than a per-season contract, so a date-derived "past supporters" band would mostly be an empty heading. `sort_order` is the officer's drag order and `public_id` is minted now, so adding a past band or a `/sponsors/$publicId` later costs nothing.

**There is a third permission, `public_sponsors:perks`, because one column on this otherwise-public page is member-only.** `sponsors.member_perk` holds a discount code or how-to-claim text; **the read action omits it from the payload entirely** (absent, not `null` — `null` is a real value meaning "this sponsor offers no perk", so sending it would still leak which sponsors have one) for a viewer without the grant. Hiding it client-side alone would ship every code in the SSR HTML of a page anonymous visitors can load. **The client check is not redundant with the server strip**: the server answers the **real** principal by design, so a sys admin previewing `anonymous` is still served the perks — `SponsorGrid` takes `canSeePerks` as a prop from `hasPermission`. Audit metadata records `hasPerk`, never the text.

**The officer form must not blank a perk it never received.** A manager holding `:manage` but not `:perks` gets no `memberPerk` in the payload, so the field is hidden and the update passes the stored value through unchanged rather than submitting an empty string over a code they can't see.

**Logos are contain-not-crop**, which is why `useImageResize` (`src/hooks/`) exists beside `useImageCrop` rather than reusing it: a wordmark is wide, a roundel square, a stacked mark tall, and a shared aspect ratio either slices lettering off or letterboxes the mark. The hook scales to fit a 640 px square, preserves the ratio, and reports exact output dimensions so the card reserves the right space. **It preserves alpha** — the canvas is never filled before the draw and WebP carries an alpha channel, whereas `useImageCrop` normalizes through a JPEG working copy and would flatten a transparent PNG onto black. **SVG is deliberately excluded from the picker's `accept`**: it rasterizes fine, but accepting it invites a pass-through later, and an inline SVG is a script-execution surface on a public page.

Every mark renders on a **light chip in both themes** (`SponsorLogo`) — sponsor logos are supplied as-is and most are dark ink on an assumed white page, so a dark card would swallow them. The card always renders the sponsor's name as visible text, which is why the image takes **`alt=""`** and why `sponsors` has no `logo_alt` column unlike `album_photos`.

`logo` on update is **three-state**: absent leaves the mark alone, an object replaces it, `null` clears it — collapsing absent with `null` would wipe the logo on every copy edit.

## Scheme-restricted URLs

`websiteUrl` (sponsors) and `signupUrl` (volunteer) are **scheme-restricted, and `z.url()` is not enough**: Zod accepts `javascript:`, `data:` and `vbscript:`, and both `:manage` permissions are seeded ungranted precisely so they can be delegated to a non-admin role — an unrestricted scheme is stored XSS handed to whoever holds that delegation. `HTTP_SCHEME` guards the write **and** the render helper (`sponsorWebsiteHref()` / `outingJoinHref`) re-checks. **The render-time check is the one that matters**, since a schema only guards writes made after it shipped and a row from a direct SQL edit bypasses it entirely. A rejected link degrades to plain text / the `mailto:`, so the entry stays useful.

## Trips (`/trips`) — a deliberate stopgap

Members need somewhere to sign up while the real trips feature is built, and the club already runs sign-ups through a Google Form — so `/trips` embeds that form in an `<iframe>` rather than leaving the link to circulate out-of-band. Gated on `requireApproved` plus `pages.trips`, which **predates the route** as the sidebar placeholder's flag.

**No `trips:*` permission exists** — permissions are DB rows and cost a migration, which isn't worth spending on a surface that gets deleted; the real feature introduces its own and can tighten the guard then.

**Waiver standing is advisory here, not a gate** — see the compliance rule. Swap in `requireCurrentWaiver` when the real feature lands and attestation is no longer the bottleneck.

**`frame-src` in `server/headers.server.ts` carries `https://docs.google.com` solely for this page** — the only third-party frame source on the site that isn't Turnstile. It comes out with the embed.

`embedded=true` belongs on the iframe `src` and **must not** ride along on the "Open in a new tab" link: it strips Google's page chrome, which is right inside a frame and wrong in a standalone tab. That link is also the recovery path when a browser refuses to frame third-party content, so it can't be dropped. Bare `<iframe>`, no fallback children, for the same hydration-mismatch reason as the gazette PDF reader. Fixed height, because a cross-origin frame's content height is unreadable.

The feature directory holds only `components/` today (no `api/`, no `server/`). It exists as a real entry in the eslint `FEATURES` array so the fences are in place when the feature grows into it.

## Sitemap

**`scripts/generate-sitemap.ts` lists only always-on pages.** A flag-gated page can be switched off and 404, so `/sponsors`, `/volunteer`, `/history` and the rest of the gated public surface are deliberately absent.
