# 0008. `events` is a base table; kinds own satellite tables

- **Status:** Accepted
- **Date:** 2026-10-08
- **Issue:** #187

## Context

The club calendar (`/calendar` plus subscribable `.ics` feeds) needed a table of things that happen at a time. Trips are coming (#275) with their own fields: leader, difficulty, capacity, cost. `volunteer_events` is meant to be restructured the same way. Features may not import each other, and three consumers is this repo's threshold for hoisting shared code to `src/server/`.

A calendar feed also has obligations a page doesn't. Subscribers' copies only change when the feed says so: a UID that changes, a `SEQUENCE` that doesn't increase, or a row that is deleted rather than published as cancelled leaves stale or duplicate events on members' phones with no error anywhere.

## Decision

- **`events` lives in `src/server/events/`, not in `features/calendar/`.** The calendar, both feeds and future features read it there.
- **Kind-specific columns go in satellite tables keyed on `event_id`**, owned by their feature, never on `events`. The calendar's read stays one indexed range scan and never learns that trips exist.
- **Visibility (`public | members | officers`) is filtered in SQL**, with the scope a required parameter, because the feeds have no session to derive one from.
- **Recurrence is calendar arithmetic in `CLUB_TIME_ZONE`** over a closed RFC 5545 subset. Anything outside it is rejected, not ignored. The feed emits series, not expanded occurrences. `ical.ts` is hand-rolled, because the dangerous parts (UID stability, `SEQUENCE`) are decisions about our own data model.
- **Times render in the club's zone**, not the viewer's, because a member in Denver needs the time the club meets.

## Consequences

- Adding trips is a new table plus a join, with no change to the calendar's read or to the feeds.
- `public_id` (the UID) must never change, every write path bumps `sequence`, and cancelling is `canceled_at`, never a DELETE.
- The feeds are the only session-less read path in the app. A bad token answers 404, never 403, and scope is computed at fetch time, which is the only way a subscription URL can be revoked.
- Two flags, deliberately: `pages.calendar` for the page and `calendar.feed_enabled` for the feeds, because breaking every member's phone calendar is a different act from hiding a page.
