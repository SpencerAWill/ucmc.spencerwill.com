/**
 * Pure date helpers for the calendar page (issue #187).
 *
 * Kept out of the components so the month-boundary and grouping
 * arithmetic is testable without rendering anything, and so there is one
 * place that knows the page reasons in `CLUB_TIME_ZONE`.
 *
 * **Every calendar-day decision here runs in the club zone**, never in
 * the viewer's and never in UTC. A member in Denver looking at the club
 * calendar wants the Wednesday the club meets, not the Tuesday evening
 * it is where they are standing — and reading a calendar field off a raw
 * instant would additionally differ between the worker (UTC) and the
 * browser, which is a hydration mismatch.
 */
import { CLUB_TIME_ZONE } from "#/config/time";
import type { CalendarOccurrence } from "#/features/calendar/server/calendar-fns";

/** The club-local calendar date an instant falls on. */
export function clubDateOf(instant: Temporal.Instant): Temporal.PlainDate {
  return instant.toZonedDateTimeISO(CLUB_TIME_ZONE).toPlainDate();
}

/** Club-local midnight starting a date, as an instant. */
export function startOfClubDay(date: Temporal.PlainDate): Temporal.Instant {
  return date.toZonedDateTime({ timeZone: CLUB_TIME_ZONE }).toInstant();
}

/**
 * The instants bounding a month's grid.
 *
 * Padded by a week either side, because the month grid renders the
 * trailing days of the previous month and the leading days of the next —
 * fetching the bare month would leave those cells blank and make an
 * event appear only once the reader paged to it.
 */
export function monthWindow(month: Temporal.PlainYearMonth): {
  from: Temporal.Instant;
  until: Temporal.Instant;
} {
  const first = month.toPlainDate({ day: 1 });
  return {
    from: startOfClubDay(first.subtract({ days: 7 })),
    until: startOfClubDay(first.add({ months: 1 }).add({ days: 7 })),
  };
}

/**
 * Occurrences bucketed by club-local date, as `YYYY-MM-DD` keys.
 *
 * A multi-day event lands in the bucket for each day it covers, so a
 * three-day trip shows on all three days of the grid rather than only
 * the day it started. Capped at a year's worth of spans per occurrence
 * so a malformed row cannot spin the loop.
 */
export function groupByClubDate(
  occurrences: readonly CalendarOccurrence[],
): Map<string, CalendarOccurrence[]> {
  const byDate = new Map<string, CalendarOccurrence[]>();

  for (const occurrence of occurrences) {
    const first = clubDateOf(occurrence.startsAt);
    const last =
      occurrence.endsAt === null ? first : clubDateOf(occurrence.endsAt);

    let cursor = first;
    for (let guard = 0; guard < 366; guard += 1) {
      const key = cursor.toString();
      const bucket = byDate.get(key);
      if (bucket) {
        bucket.push(occurrence);
      } else {
        byDate.set(key, [occurrence]);
      }
      if (Temporal.PlainDate.compare(cursor, last) >= 0) {
        break;
      }
      cursor = cursor.add({ days: 1 });
    }
  }

  return byDate;
}

/**
 * `Temporal.PlainDate` → the `Date` react-day-picker requires.
 *
 * DayPicker is a hard external boundary: it reasons in `Date` and in
 * the *browser's* zone. Building the Date from the date's own
 * year/month/day components — rather than from the instant — keeps the
 * calendar-day identity intact whatever zone the viewer is in, which is
 * the whole point: the cell labelled "6" must be the club's 6th.
 */
export function toPickerDate(date: Temporal.PlainDate): Date {
  return new Date(date.year, date.month - 1, date.day);
}

/** The inverse of {@link toPickerDate}. */
export function fromPickerDate(date: Date): Temporal.PlainDate {
  return Temporal.PlainDate.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}

/** Today, in the club's zone rather than the viewer's. */
export function clubToday(now: Temporal.Instant = Temporal.Now.instant()) {
  return clubDateOf(now);
}

/**
 * `<input type="datetime-local">` value → an instant.
 *
 * The input hands over a bare wall-clock string with no zone. It is
 * read as CLUB time, not the browser's: an officer in another zone
 * publishing "Wednesday 6pm" means 6pm in Cincinnati, and the page
 * renders every other time that way too. Reading it as the browser's
 * zone would silently shift the event for everyone else.
 */
export function instantFromClubInput(value: string): Temporal.Instant | null {
  if (value === "") {
    return null;
  }
  try {
    return Temporal.PlainDateTime.from(value)
      .toZonedDateTime(CLUB_TIME_ZONE)
      .toInstant();
  } catch {
    return null;
  }
}

/** The inverse: an instant → the `datetime-local` value, in club time. */
export function clubInputFromInstant(instant: Temporal.Instant): string {
  return (
    instant
      .toZonedDateTimeISO(CLUB_TIME_ZONE)
      .toPlainDateTime()
      // `datetime-local` wants minute precision; seconds make Safari
      // render a seconds spinner nobody asked for.
      .round({ smallestUnit: "minute", roundingMode: "floor" })
      .toString({ smallestUnit: "minute" })
  );
}
