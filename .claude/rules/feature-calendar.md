---
paths:
  - "apps/ucmc-web/src/features/calendar/**"
  - "apps/ucmc-web/src/server/events/**"
  - "apps/ucmc-web/src/routes/calendar.tsx"
  - "apps/ucmc-web/src/routes/api/calendar.*"
  - "apps/ucmc-web/src/routes/my._tabs.calendar.tsx"
---

# Club calendar and iCal feeds (issue #187)

Two surfaces over one data source: `/calendar` (month grid + agenda, officer authoring inline) and the subscribable `.ics` feeds.

## `events` is a base table, not a feature's table

**It lives in `src/server/events/`, not in `src/features/calendar/`.** The calendar reads it for the page and both feeds; `features/trips` will own a satellite table keyed on `event_id` (leader, difficulty, capacity, cost) and `volunteer_events` is intended to be restructured the same way. Three features is this repo's threshold for hoisting — the alternative is a `FEATURE_PUBLIC_API` entry existing only so siblings can reach into the calendar's internals. Same split the audit log uses: shared recorder in `src/server/audit/`, read-side viewer in `features/audit/`.

So: **kind-specific columns belong in a satellite table, never on `events`.** The calendar's read stays a single indexed range scan and never learns that trips exist.

## Three columns are iCalendar's, not ours

Get any of them wrong and it fails silently, surfacing a week later as "my phone has forty copies of the weekly meeting".

- **`sequence`** — RFC 5545's revision counter. Clients ignore an incoming `VEVENT` that doesn't beat the copy they hold, so **every write path bumps it**, cancellation and per-occurrence overrides included. Incremented in SQL (`sequence + 1`), never read-modify-written, so two officers saving at once can't both land on the same value.
- **`public_id`** — the emitted `UID` derives from it (`<public_id>@ucmc.spencerwill.com`) and **must never change**. A UID that varies between polls makes every client treat each poll's events as new.
- **`canceled_at`, not a DELETE** — a cancelled event has to be _published_ as `STATUS:CANCELLED` for subscribers' copies to disappear. A row that merely stops being emitted reads to most clients as "no change" and sits on the phone forever. The delete confirmation says so and points officers at cancel.

## Recurrence is calendar arithmetic, never instant arithmetic

`starts_at` anchors the **first** occurrence only. `src/server/events/recurrence.ts` derives the rest by stepping _dates_ in `CLUB_TIME_ZONE` and re-attaching the anchor's wall-clock time, so a weekly 18:00 meeting is still 18:00 after the clocks change. Adding `7 × 24h` to an epoch drifts an hour every March and November — `club-clock.test.ts` pins the same distinction for retention windows, and `recurrence.test.ts` pins it here across both transitions.

**Durations are wall-clock too**: 18:00–19:00 stays 18:00–19:00 on the November Sunday when the hour repeats. Exact-elapsed is right for a timeout; for something humans show up to, the local clock is the contract.

**The subset is closed and everything else is rejected, not ignored**: `FREQ=WEEKLY|MONTHLY`, `INTERVAL`, `BYDAY`, `UNTIL`, `COUNT`. Silently dropping a component would give the feed and the page different occurrence sets — a member's phone and the website each confidently wrong in a different way, with nothing to notice it. The `rrule` npm package was rejected deliberately: `Date`-based and UTC-centric, so it fights the Temporal rule at exactly the DST boundary that matters.

Two conformance points where the obvious implementation is wrong, both pinned:

- **WKST defaults to MO**, so `INTERVAL=2` steps from the Monday on or before the anchor. Stepping from the anchor's own weekday puts `MO` and `WE` in different fortnights whenever the anchor isn't a Monday — exactly the shape of an "every other week, Mon and Wed" schedule.
- **A monthly rule skips months too short for its day-of-month** (RFC 5545 §3.3.10), it does not clamp. Clamping walks "the 31st" back to Feb 28 and out again, which reads as the event wandering.

**Officers never type an RRULE.** `features/calendar/lib/recurrence-form.ts` compiles the four shapes a club uses, and its build/parse round-trip is separately tested — that's where a bug would silently reschedule a series the next time anyone opened it to fix a typo. Its output is also asserted to parse under the server's own validator, so a repeat the form accepts can never be one the save rejects.

## Exceptions are keyed on the slot the series generated

`event_exceptions.occurrence_start` is the occurrence's **original** start — iCalendar's `RECURRENCE-ID` — so a moved occurrence stays addressable. `NULL` on an override column means **inherit from the series**, not "unset", so a later fix to the series title flows through to an occurrence that was only moved.

**Moving a series' anchor (or changing its rule) clears its exceptions**, by design: they point at slots that no longer exist, and silently re-pointing "no meeting that week" would cancel an arbitrary different week.

## Visibility is filtered in SQL, never in the payload

`visibility` is `public | members | officers`, strictly nested, so every read takes one `visibility IN (...)`. An officers-only event that reached the SSR payload of a page a member can load would be readable from View Source whatever the component rendered — **and would land in that member's phone the moment they subscribed.**

The scope is a **required parameter** on the repo, not something it derives: the `.ics` feed resolves a bearer token to a user and has no session to read a principal from. `visibilityScopeFor(isApprovedMember, canReadPrivate)` builds it so both callers agree.

There is deliberately **no `events:view`** — being an approved member is the qualification, as `/trips` decided. `events:read_private` is the one that earns its keep; `events:manage` covers every write.

## The feeds are the only session-less read paths in the app

A calendar client polls in the background with no cookies and no way to complete an auth flow.

- **Scope is computed from the token's user at fetch time, never baked in.** That is the only revocation story a subscription URL has: an officer who loses their role stops seeing exec events on their next poll.
- **A bad token answers 404, never 403.** Distinguishing "no such token" from "revoked" turns a publicly reachable endpoint into an oracle for walking token space. The token is never logged and never lands in an audit row's `target_id` — the row id goes there, because the audit viewer renders it as visible text.
- **`calendar_subscriptions` is its own table, not a `users` column**: rotation without destroying history, one labelled token per device, `last_fetched_at` to answer "is Google actually polling this?", and revocation as a timestamp the audit log can point at. Revocation is `revoked_at`, never a DELETE — keeping the row is what guarantees the UNIQUE index can't reissue a leaked token. Revoked rows therefore don't count toward the per-member cap.
- **A token is returned exactly once**, on the response that mints it. The list query carries labels and timestamps, never tokens; a member who loses their link rotates.
- **The kind filter is baked into the URL, not stored per member.** `?kind=trip,meeting` is what lets a member subscribe twice from the same account and get trips and meetings as two separately-coloured calendars in their phone, each toggled on its own — which a single stored preference could never give them. Nothing selected means everything; an empty filter and a fully-selected one produce the same feed, which is why the chips start empty rather than all-on.

**Feeds emit series, not expanded occurrences** — one `VEVENT` with its `RRULE`, plus `EXDATE`s and `RECURRENCE-ID` overrides. An expanded feed has a horizon, so a member who subscribes and never opens the site again silently stops seeing the weekly meeting the day it passes. An override must **not** carry the series' `RRULE`, or the client reads it as a second infinite series.

`src/server/events/ical.ts` is hand-rolled rather than taking the `ics` package — the dangerous parts (UID stability, SEQUENCE) are decisions about our own data model, and `VTIMEZONE` is fixed text, expressed as yearly RRULEs so it stays correct without an annual refresh. Watch for:

- **`DTSTART` carries an explicit `TZID` and the file carries a matching `VTIMEZONE`.** A floating or naive-UTC timestamp renders an hour off for half the year — and you'll test it in the half where it looks right.
- **All-day events use floating `DATE` values with no `TZID` and an exclusive `DTEND`.** Without the `+1` they render zero-length and vanish from some month views.
- **Line folding counts octets, not characters**, and must never split a multi-byte sequence.
- **Escape backslash first.** Doing it last double-escapes what the other replacements introduced. `escapeText` shipped with `"\;"` where `"\;"` was meant — JavaScript reads that as a bare `;`, so semicolons were never escaped and a title like "Gear night; bring boots" would have split the `SUMMARY` property. The assertion that caught it is built from an explicit `\`, because counting backslashes is the one thing a string literal makes unreadable.

The ETag is a **content hash, not `max(updated_at)`** — a timestamp tag misses a deletion entirely, so subscribers keep getting 304s and never learn the event is gone. It also differs between scopes, so one viewer's 304 can't hand them another's feed.

## Two flags, deliberately

`pages.calendar` gates the page; **`calendar.feed_enabled` gates the feeds.** Switching off a page and silently breaking every member's phone calendar are different acts with different blast radii, and either may be wanted without the other. `pages.my_calendar` separately gates the subscription-management tab — switching it off stops members minting new links while existing subscriptions keep working.

## Page shape

Month grid with **dots, not event chips** — the Apple Calendar / Luma shape. Chips in a 40px cell are unreadable at the 400px width most members open this at and need a dedicated calendar library; dots degrade to "something's on, tap to see". That also means `react-day-picker` (already a dependency) is sufficient. The agenda beside it carries the detail and shows the **whole visible month**, because the default reading of a club calendar is "what's coming up".

The agenda is stacked `<li>` rows, not a table — a find-one-and-act surface per the responsive-collections rule.

**Times render in `CLUB_TIME_ZONE`, deliberately not through `#/lib/date-format`**, which renders in the viewer's zone. A member in Denver needs the time the club is meeting, and a viewer-zone time would let a row say 4:00 PM under a heading that says Wednesday. The day buckets use the same zone so the two can't disagree. `react-day-picker` is a hard `Date`-and-browser-zone boundary: build its `Date` from the plain date's components, never from the instant.

`/calendar` and `/my/calendar` are both in `mobile-overflow.spec.ts`'s route list. The month grid is a seven-column table that cannot reflow, next to a chip row and an agenda of badge-carrying rows — the densest fixed-width surface on the site, and exactly the shape that reaches past the gutter.

**`/calendar` is a public page** (`0076`), gated like every other one: the `pages.calendar` flag plus `public_calendar:view`, which `role_anonymous` holds. It shipped member-only, which left an incoherence — the anonymous `.ics` feed exists for prospective members, and the only surface linking to it was itself member-only, so its audience could never see it.

**Reaching the page and seeing an event are different questions.** One permission covers anonymous visitors and members alike because the second question is answered per row by `visibility` in the SQL `WHERE`. There is still no `events:view`. **Opening the page did not open its contents**: events default to `visibility = 'members'`, so an officer marks an event public one at a time and a crawler sees only those.

An anonymous visitor gets the public-feed card instead of a Subscribe button — minting a personal token needs an account, and a button that bounces them to sign-in is worse than no button. `/my/calendar` stays member-only and owns personal links only.

## Test layout

The unit suites cover the pure layers — recurrence, occurrence building, the serializer, the actions. Three e2e specs cover what they structurally cannot:

- **`calendar.spec.ts`** — the page renders, hydrates clean, the grid is a real tap target, range selection and the type filter reach the URL, an event opens at its own route. Every defect this page shipped was invisible to jsdom: a render-time throw, cells that looked right and could not be clicked, a zone-derived `today` that broke hydration. The console-error assertions and the bounding-box check look paranoid and are exactly the two that would have caught them.
- **`calendar-feed.spec.ts`** — the `.ics` route's HTTP contract, driven through Playwright's `request` because there is no page. This is **the only publicly reachable, session-less endpoint in the app**, so its contract _is_ the security boundary: bad token 404s (never 403, which would make it an oracle), revocation takes effect immediately, `Cache-Control` is `private` for a member feed, the feed flag gates it, and a second fetch yields 304 — the assertion that failed before `DTSTAMP` was stripped from the ETag hash.
- **`calendar-authoring.spec.ts`** — the recurrence builder, asserting against the stored `rrule` rather than the dialog. It is the highest-consequence control in the feature and its failure mode is not a crash: an officer picks a repeat, saves, and a semester lands on the wrong days in every subscriber's phone with no error anywhere. Also pins that editing a series from a _later_ occurrence does not move its anchor.

Title assertions in the authoring spec take `.first()`: a recurring series renders one agenda row per occurrence.

## Not done yet

- **`meeting.day_time` now has a structured twin** and the two can disagree. Deriving the landing block from a recurring meeting event would mean `landing → events`, which the boundary rule forbids without hoisting.
- **A public `/calendar` page** for prospective members becomes natural now that `visibility = 'public'` exists; the data model doesn't preclude it. The public _feed_ is reachable today from `/my/calendar`, so a member has something to hand a non-member — but a prospective member still has no way to find it without being told, and nothing embeds it on the landing page.
- **Gear due dates / waiver expiry** on the calendar. The satellite shape doesn't preclude a projection later.
- **Event reminder notifications** — a `notification-registry.ts` entry is the whole change, no migration.
