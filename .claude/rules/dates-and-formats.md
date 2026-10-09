---
paths:
  - "apps/ucmc-web/src/**"
---

# Dates, times, and phone numbers

## Temporal is the timestamp type everywhere

Via the `temporal-polyfill` global installed at every entry point (`server-entry.ts`, `router.tsx`, both vitest setup files) — workerd and Safari < 17 have no native Temporal. There is no `date-fns`; raw `Date` survives only at hard external boundaries (R2's `object.uploaded`, `<input type="date">` glue, `Set-Cookie` `maxAge` is a number).

- **DB**: the `drizzle/schema.ts` `timestamp` helper is a `customType` storing integer-ms but reading/writing `Temporal.Instant`. Inserts and query bounds (`gte`/`lt`) pass Instants. `Temporal` values cross the SSR / server-fn wire via the **serialization adapters** registered on `createStart` in `src/start.ts` (`#/lib/temporal-serialization.ts`). Numeric `*Ms` DTO fields stay numbers via `.epochMilliseconds`.
- **Calendar reasoning runs in `CLUB_TIME_ZONE`** (`src/config/time.ts`, `America/New_York`) — club season, gear due-date end-of-day, officer-archive year, Gazette publish date, the `{year}` token in the header tagline. Convert `instant.toZonedDateTimeISO(CLUB_TIME_ZONE)` first; **never** UTC, never the runtime-default zone. The worker runs UTC and the browser runs the viewer's zone, so reading a calendar field off a raw instant is also a hydration-mismatch source.
- **Display goes through `#/lib/date-format`** (`formatDate` / `formatDateTime` / `formatRelative` / `toDateInputValue`) — absolute timestamps render in the **viewer's** local zone; `formatRelative` is locale-pinned to `"en"`.

### Never re-derive the club year

`src/config/club-season.ts` exports `currentSeason(now: Temporal.Instant)` returning `"YYYY-YY"`, rolling over **August 1** (`CLUB_SEASON_START`) at **midnight Cincinnati-local**. A season runs Aug 1 → Jul 31, and **the waiver term is that same season** — `requireCurrentWaiver`, `/volunteer`'s service archive and member tenure all read this one helper. **Always import it**; a parallel August boundary would disagree the first time the boundary moved, which it has: it used to sit on Aug 21, a fake-precise proxy for UC's first day of classes, a date that moves every year. Aug 1 is earlier than the earliest club trip and does not pretend to be the academic calendar. Tests pin `now` (pass a `Temporal.Instant`, e.g. `Temporal.Instant.from("2025-08-01T00:00:00-04:00")`).

The same module owns the range math, so reporting code never re-derives it in a query:

| Helper                           | Answers                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `seasonBoundsFor(season)`        | the `[start, end)` instants a `"YYYY-YY"` season covers                       |
| `seasonsBetween(from, to)`       | every season label a range touches, oldest first, gaps included               |
| `seasonOffsetOf(instant)`        | `{ season, monthIndex }`, **0 = August** — for overlaying seasons on one axis |
| `semesterOf(instant)`            | `{ season, semester }`                                                        |
| `semesterBoundsFor(season, sem)` | the `[start, end)` instants one reporting period covers                       |

**Ranges are half-open**, matching the `gte`/`lt` query bounds above: the instant a season ends is the instant the next begins, and belongs to the later one.

### `SEMESTERS` are reporting periods, not UC's academic calendar

Fall Aug–Dec, Spring Jan–Apr, Summer May–Jul. They **partition the season totally** — every loan, trip and activity day lands in exactly one, which is what makes a semester-bucketed report sum to the season. UC's published calendar is week-shaped, moves yearly, and has gaps belonging to no term (winter break), so modelling it here would strand break activity; under this split December break counts as Fall and January break as Spring. If real term dates are ever needed, that is an `academic_terms` table of hand-entered published dates, not a change to this partition.

**The three are unequal — 5, 4 and 3 months — so any per-month rate must divide by `SEMESTERS[s].monthCount`.** A bar chart of raw semester totals makes Fall look busier than it is for free.

`SEASON_END_CUTOFF` (`server/member-profile/season-progress.ts`) sits on the same May 1 as the Spring/Summer boundary and is deliberately not derived from it — that one is a reporting bucket, this is the finish line of a member's profile ring.

## Phone numbers

**E.164 is the storage form** (`+15135551234`). `PhoneField` (`src/lib/form/fields.tsx`) writes it via `react-phone-number-input/input` (the bare input, no country-flag dropdown), and `phoneSchema` in `src/server/profile/profile-schemas.ts` validates every write with `isValidPhoneNumber`. There is no separate phone dep: `react-phone-number-input` wraps `libphonenumber-js` and its bundled "min" metadata already carries the national formatting patterns.

**Display goes through `#/lib/phone-format`** — the presentation-layer counterpart to `#/lib/date-format`. `formatPhone()` renders `DEFAULT_PHONE_COUNTRY` numbers in national form (`(513) 555-1234`) and everything else international (`+44 20 7123 4567`), because a non-local number's national form is undialable from here. `phoneHref()` returns the `tel:` URI. **Never interpolate a stored phone into JSX directly** — E.164 is for the dialer and the database, not for reading.

Both helpers gate on `isValid()`, not merely parseable, and **fall back to the stored string verbatim** rather than a lossy reformat: `+1513` parses with no country and would otherwise render as the fragment `513`. Only rows predating the schema validation can reach that path, and showing the digits on file beats showing nothing.

**`DEFAULT_PHONE_COUNTRY` is exported from `phone-format` and imported by `PhoneField`** so the input's country default and the display's "is this local?" test can't drift.

**`<PhoneLink>`** (`src/components/phone-link.tsx`) is the render component: formatted text, `tel:` href, and a plain `<span>` when the number isn't dialable. The branch lives in one place because an `<a>` with no `href` still reads as a link. Click-to-call is the point for emergency contacts — those get read on a phone in a situation where retyping ten digits is the last thing anyone should do.
