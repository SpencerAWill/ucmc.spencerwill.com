/**
 * Shared date/time formatting for `Temporal.Instant` values.
 *
 * Replaces the scattered `date-fns` (`format`, `formatDistanceToNowStrict`)
 * and `toLocaleDateString` / `Intl.RelativeTimeFormat` call sites, plus the
 * three duplicated hand-rolled `formatRelative` copies that lived in the
 * announcement / feedback / club-feedback cards.
 *
 * All absolute formats render in the viewer's local time zone — the runtime
 * default `Temporal.Instant.prototype.toLocaleString` uses — matching the
 * previous `date-fns` / `toLocaleString` behavior. (The instants themselves
 * are computed in the club zone where calendar semantics matter; see
 * `#/config/time`.)
 */

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> =
  [
    { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
    { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
    { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
    { unit: "day", ms: 24 * 60 * 60 * 1000 },
    { unit: "hour", ms: 60 * 60 * 1000 },
    { unit: "minute", ms: 60 * 1000 },
  ];

const DATE_MED: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

/** Medium absolute date — "Mar 5, 2026" by default. Pass options to override. */
export function formatDate(
  instant: Temporal.Instant,
  options: Intl.DateTimeFormatOptions = DATE_MED,
): string {
  return instant.toLocaleString(undefined, options);
}

/** Absolute date + time — "Mar 5, 2026, 2:30:45 PM" by default. */
export function formatDateTime(
  instant: Temporal.Instant,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "medium",
  },
): string {
  return instant.toLocaleString(undefined, options);
}

/**
 * `YYYY-MM-DD` for an `<input type="date">`, extracted in `timeZone`
 * (UTC by default, matching how date-only fields are stored at UTC
 * midnight). Pass `Temporal.Now.timeZoneId()` for runtime-local extraction.
 */
export function toDateInputValue(
  instant: Temporal.Instant,
  timeZone: string = "UTC",
): string {
  return instant.toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

/** Relative-to-now phrasing — "3 days ago" / "in 2 hours" / "just now". */
export function formatRelative(instant: Temporal.Instant): string {
  const diffMs = instant.epochMilliseconds - Date.now();
  const abs = Math.abs(diffMs);
  for (const { unit, ms } of RELATIVE_UNITS) {
    if (abs >= ms) {
      return RELATIVE.format(Math.round(diffMs / ms), unit);
    }
  }
  return "just now";
}
