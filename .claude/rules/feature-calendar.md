---
paths:
  - "apps/ucmc-web/src/features/calendar/**"
  - "apps/ucmc-web/src/server/events/**"
  - "apps/ucmc-web/src/routes/calendar.tsx"
  - "apps/ucmc-web/src/routes/api/calendar.*"
  - "apps/ucmc-web/src/routes/my._tabs.calendar.tsx"
---

# Club calendar and iCal feeds

Why `events` is a base table, why recurrence is club-zone calendar arithmetic, and why the feeds are hand-rolled: `docs/adr/0008-events-is-a-base-table.md`. This file is the rules for changing it.

## Where things go

- **`src/server/events/`**: the `events` table's repo, `recurrence.ts` (occurrence expansion), `ical.ts` (the serializer). Not in `features/calendar/`.
- **`features/calendar/`**: `/calendar` (month grid + agenda, officer authoring inline) and `/my/calendar` (personal subscription links). `lib/recurrence-form.ts` compiles the four repeat shapes officers pick into an RRULE.
- **Satellite tables keyed on `event_id`** belong to their feature (`features/trips` next; `volunteer_events` to follow).
- **`calendar_subscriptions`**: one labelled token per device, `last_fetched_at`, `revoked_at`.
- **Tests**: unit suites for recurrence, occurrence building, the serializer and the actions. Three e2e specs cover what they can't: `calendar.spec.ts` (renders, hydrates clean, real tap targets, URL state), `calendar-feed.spec.ts` (the `.ics` HTTP contract, via Playwright's `request`), `calendar-authoring.spec.ts` (the recurrence builder, asserted against the stored `rrule`).

## Rules that are easy to break

**Data model**

- **Kind-specific columns go in a satellite table, never on `events`.** The calendar's read stays one indexed range scan.
- **`sequence` is bumped by every write path**, cancellation and per-occurrence overrides included, in SQL (`sequence + 1`), never read-modify-write.
- **`public_id` never changes**: the feed's `UID` is `<public_id>@ucmc.spencerwill.com`.
- **Cancel is `canceled_at`, never a DELETE**: a cancelled event must be published as `STATUS:CANCELLED` for subscribers' copies to go. The delete confirmation points officers at cancel.
- **`event_exceptions.occurrence_start` is the original slot** (`RECURRENCE-ID`). `NULL` on an override column means inherit from the series.
- **Moving a series' anchor or changing its rule clears its exceptions**, by design; never re-point them.

**Recurrence**

- **Step dates in `CLUB_TIME_ZONE` and re-attach the anchor's wall-clock time**; never add `7 × 24h`. Durations are wall-clock too. `recurrence.test.ts` pins both DST transitions.
- **The RRULE subset is closed and anything else is rejected, not ignored**: `FREQ=WEEKLY|MONTHLY`, `INTERVAL`, `BYDAY`, `UNTIL`, `COUNT`. Don't add the `rrule` package (`Date`-based, UTC-centric).
- **WKST defaults to MO**: `INTERVAL=2` steps from the Monday on or before the anchor.
- **A monthly rule skips months too short for its day**, never clamps (RFC 5545 §3.3.10).
- **Officers never type an RRULE.** `recurrence-form.ts`'s build/parse round-trip is tested, and its output must parse under the server's validator.

**Visibility and feeds**

- **Visibility (`public | members | officers`, nested) is filtered in the SQL `WHERE`**, never in the payload. The scope is a required repo parameter; `visibilityScopeFor(isApprovedMember, canReadPrivate)` builds it.
- **No `events:view` permission.** Approved membership is the qualification; `events:read_private` and `events:manage` are the two that exist. `/calendar` itself is public (`pages.calendar` + `public_calendar:view`, held by `role_anonymous`); events default to `visibility = 'members'`.
- **Feed scope is computed from the token's user at fetch time**, never baked in.
- **A bad token answers 404, never 403.** Never log the token or put it in an audit `target_id` (use the row id).
- **Revocation is `revoked_at`, never a DELETE**, so the UNIQUE index can't reissue a leaked token. Revoked rows don't count toward the per-member cap.
- **A token is returned once**, on the response that mints it. List queries never carry tokens.
- **The kind filter lives in the URL** (`?kind=trip,meeting`), not per member. Empty means everything, which is why the chips start empty.
- **Feeds emit series, not expanded occurrences**: one `VEVENT` with its `RRULE`, plus `EXDATE`s and `RECURRENCE-ID` overrides. An override never carries the series' `RRULE`.
- **`DTSTART` carries a `TZID`, and the file a matching `VTIMEZONE`** (fixed text, yearly RRULEs).
- **All-day events are floating `DATE`s with an exclusive `DTEND`** (the `+1`).
- **Line folding counts octets** and never splits a multi-byte sequence.
- **Escape backslash first** (`escapeText`). The escaping test builds its expectation from an explicit `\`.
- **A member feed is `Cache-Control: private`**, and a repeat fetch yields 304 (`calendar-feed.spec.ts` pins both).
- **The ETag is a content hash** (without `DTSTAMP`), never `max(updated_at)`, and differs between scopes.
- **Two flags**: `pages.calendar` gates the page, `calendar.feed_enabled` the feeds; `pages.my_calendar` gates minting links while existing subscriptions keep working.

**Page**

- **Times render in `CLUB_TIME_ZONE`, deliberately not through `#/lib/date-format`**; day buckets use the same zone.
- **`react-day-picker` is a `Date` boundary**: build its `Date` from the plain date's components, never from the instant.
- **Month grid with dots, not event chips**; the agenda shows the whole visible month as stacked `<li>` rows, not a table.
- **An anonymous visitor gets the public-feed card**, not a Subscribe button. `/my/calendar` stays member-only.
- **`/calendar` and `/my/calendar` stay in `reflow-pages.spec.ts`.**
- **Authoring-spec title assertions take `.first()`**: a series renders one agenda row per occurrence.
- **Ignore router-core's `Cannot read properties of undefined (reading '_nonReactive')`** from an abandoned hover preload (`loadRouteMatch`, an unguarded access in the library). Don't contort route code around it and don't write an e2e test for it; the race can't be hit deterministically. Clicking agenda rows on a large local DB needs a generous timeout (Playwright is scrolling).

## Adding things

- **A new event kind** is a satellite table in its feature plus a `kind` value; the calendar's read and the feeds don't change.
- **A new write path** bumps `sequence` in SQL.
- **Event reminder notifications** are a `notification-registry.ts` entry, no migration.

## Not built yet

- **`meeting.day_time` has a structured twin and the two can disagree.** Deriving the landing block from the meeting event would need `landing → events`, which the boundary rule forbids without hoisting.
- **Nothing embeds the public feed on the landing page.**
- **Gear due dates and waiver expiry on the calendar**; the satellite shape doesn't preclude a projection.
