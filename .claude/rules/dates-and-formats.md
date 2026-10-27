---
paths:
  - "apps/ucmc-web/src/**"
---

# Dates, times, and phone numbers

Why Temporal, and why the polyfill is forced: `docs/adr/0003-temporal-everywhere-forced-polyfill.md`. Why the season is Aug 1 and the waiver term: `docs/adr/0004-the-club-season-is-the-waiver-term.md`. This file is the rules for working with them.

## Where things go

- **`#/lib/temporal-install`** installs `temporal-polyfill` onto the global; every entry point imports it first (`server-entry.ts`, `router.tsx`, `.storybook/preview.ts`, the vitest setup files, the e2e DB fixture). Code reads the global `Temporal`.
- **`drizzle/schema.ts`'s `timestamp`** is a `customType`: integer ms in D1, `Temporal.Instant` in code. Inserts and query bounds (`gte`/`lt`) pass Instants. Numeric `*Ms` DTO fields stay numbers via `.epochMilliseconds`.
- **`#/lib/temporal-serialization.ts`**, registered on `createStart` in `src/start.ts`, carries Temporal values across the SSR and server-fn wire.
- **`src/config/time.ts`** exports `CLUB_TIME_ZONE` (`America/New_York`).
- **`#/lib/date-format`** (`formatDate` / `formatDateTime` / `formatRelative` / `toDateInputValue`) renders absolute timestamps in the **viewer's** zone; `formatRelative` is locale-pinned to `"en"`.
- **`src/config/club-season.ts`** owns the season and all its range maths:

  | Helper                           | Answers                                                                                      |
  | -------------------------------- | -------------------------------------------------------------------------------------------- |
  | `currentSeason(now)`             | the `"YYYY-YY"` label, rolling over `CLUB_SEASON_START` (Aug 1) at midnight Cincinnati-local |
  | `seasonBoundsFor(season)`        | the `[start, end)` instants a season covers                                                  |
  | `seasonsBetween(from, to)`       | every season label a range touches, oldest first, gaps included                              |
  | `seasonOffsetOf(instant)`        | `{ season, monthIndex }`, **0 = August**, for overlaying seasons on one axis                 |
  | `semesterOf(instant)`            | `{ season, semester }`                                                                       |
  | `semesterBoundsFor(season, sem)` | the `[start, end)` instants one reporting period covers                                      |

- **Phones**: `PhoneField` (`src/lib/form/fields.tsx`, the bare `react-phone-number-input/input`) writes E.164; `phoneSchema` (`src/server/profile/profile-schemas.ts`) validates every write with `isValidPhoneNumber`; `#/lib/phone-format` (`formatPhone`, `phoneHref`) displays; `<PhoneLink>` (`src/components/phone-link.tsx`) renders. No separate phone dependency: `react-phone-number-input` wraps `libphonenumber-js`.

## Rules that are easy to break

- **Never import `temporal-polyfill` or `temporal-polyfill/global` (or their `/full` twins, or the shim's `install()`) in `src/`.** All of them defer to a native `Temporal`. ESLint bans them. Moving to native is an edit to `temporal-install.ts`, never something the runtime decides.
- **No `date-fns`, and raw `Date` only at hard boundaries** (R2's `object.uploaded`, `<input type="date">` glue, `react-day-picker`, `Set-Cookie` `maxAge`).
- **Calendar reasoning converts to `CLUB_TIME_ZONE` first** (`instant.toZonedDateTimeISO(CLUB_TIME_ZONE)`): club season, gear due-date end of day, officer-archive year, Gazette publish date, the header tagline's `{year}`. Never UTC, never the runtime default. Reading a calendar field off a raw instant is also a hydration mismatch.
- **Never re-derive the club year or an August boundary.** Import from `club-season.ts`; the waiver guard, `/volunteer`, tenure and analytics all read it. Tests pin `now` with a `Temporal.Instant`, e.g. `Temporal.Instant.from("2025-08-01T00:00:00-04:00")`.
- **Ranges are half-open**: the instant a season ends belongs to the next.
- **`SEMESTERS` are reporting periods, not UC's academic calendar**: Fall Aug–Dec, Spring Jan–Apr, Summer May–Jul, partitioning the season totally. Don't model real term dates here; that would be an `academic_terms` table.
- **Per-month rates divide by `SEMESTERS[s].monthCount`** (5, 4, 3). Raw totals flatter Fall.
- **`SEASON_END_CUTOFF`** (`server/member-profile/season-progress.ts`) shares the May 1 date with the Spring/Summer boundary but is deliberately not derived from it.
- **Never interpolate a stored phone into JSX.** Go through `formatPhone` / `<PhoneLink>`: national form for `DEFAULT_PHONE_COUNTRY`, international otherwise (a non-local national form is undialable).
- **Phone helpers gate on `isValid()` and fall back to the stored string verbatim**, never a lossy reformat (`+1513` would otherwise render as `513`).
- **`DEFAULT_PHONE_COUNTRY` is exported from `phone-format` and imported by `PhoneField`**, so input default and display can't drift.
- **`<PhoneLink>` renders a plain `<span>` when the number isn't dialable**; an `<a>` without `href` still reads as a link.

## Adding things

- **A new entry point** (a worker export, a test pool, a Storybook) imports `#/lib/temporal-install` before anything else.
- **A new season- or semester-shaped question** gets a helper in `club-season.ts` with a test, not a query that re-derives bounds.
- **A new timestamp column** uses the schema's `timestamp` helper; a DTO that needs a number exposes `*Ms`.
