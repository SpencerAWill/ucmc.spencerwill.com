/**
 * An Album photo's date is a bare calendar day, stored as UTC midnight.
 *
 * `album_photos.taken_at` is a timestamp column, but every reader treats it
 * as a date: `photo-grid.tsx` reads the year with `toZonedDateTimeISO("UTC")`
 * and `toDateInputValue` defaults to UTC. This is deliberately NOT
 * `CLUB_TIME_ZONE`: the club-time-zone rule is about real moments in time,
 * and moving this value there would show every existing photo a day early.
 * The EXIF date is used as-is for the same reason: a photo taken at 23:00 in
 * Utah is dated the day the photographer saw.
 */

/**
 * `YYYY-MM-DD` from the date input to the UTC-midnight `Date` the server fn
 * sends. Throws on a date that does not exist (`2024-02-30`) rather than
 * clamping it.
 */
export function albumTakenDateToWire(value: string): Date {
  return new Date(
    Temporal.PlainDate.from(value, { overflow: "reject" }).toZonedDateTime(
      "UTC",
    ).epochMilliseconds,
  );
}
