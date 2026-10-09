/**
 * iCalendar (RFC 5545) serialization for the club's subscribable feeds
 * (issue #187).
 *
 * Hand-rolled rather than taking the `ics` package: what a VEVENT needs
 * is string formatting and a correct VTIMEZONE, and the package would
 * be a dependency against the `minimumReleaseAge` posture for about
 * eighty lines of output. The parts that are genuinely easy to get
 * wrong are not the parts a library would have saved us from — they are
 * UID stability and SEQUENCE, which are decisions about our own data
 * model, and the VTIMEZONE block, which is fixed text.
 *
 * Three things here are load-bearing, and each fails in a way that
 * looks fine locally:
 *
 *   1. **UID is derived from the event's `public_id` and never from
 *      anything regenerated per render.** A UID that changes between
 *      polls makes every client treat each poll's events as new, so a
 *      member ends up with one copy of the weekly meeting per poll,
 *      forever.
 *   2. **SEQUENCE must increase on every published revision.** Clients
 *      compare it against the copy they hold and ignore an incoming
 *      VEVENT that does not beat it, so a stale SEQUENCE means edits
 *      silently never appear. The action layer bumps the column; this
 *      module just emits it.
 *   3. **DTSTART carries an explicit TZID and the file carries a
 *      matching VTIMEZONE.** A floating or naive-UTC timestamp renders
 *      an hour off for half the year — and you will test it in the half
 *      where it looks right.
 */
import { CLUB_TIME_ZONE } from "#/config/time";
import type { CalendarOccurrence } from "#/server/events/occurrences";

/**
 * The UID domain. Part of each event's identity forever, so it is a
 * constant here rather than read from `APP_BASE_URL` — a domain change
 * must not silently re-identify every event in every subscriber's
 * calendar.
 */
const UID_DOMAIN = "ucmc.spencerwill.com";

const PRODID = "-//UCMC//Club Calendar//EN";

/**
 * VTIMEZONE for America/New_York.
 *
 * Static, and expressed as RRULEs rather than as a list of
 * transitions — which is how RFC 5545 intends it and means the block
 * stays correct for every year under the current US DST rules rather
 * than needing a yearly refresh. If Congress changes those rules this
 * needs updating; nothing else here does.
 */
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${CLUB_TIME_ZONE}`,
  "X-LIC-LOCATION:America/New_York",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "TZNAME:EDT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "TZNAME:EST",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/**
 * Escape a TEXT value per RFC 5545 §3.3.11.
 *
 * Backslash first — escaping it after the others would double-escape
 * the backslashes they just introduced.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold a content line to 75 octets per RFC 5545 §3.1.
 *
 * Measured in **octets, not characters**: the limit is bytes, and a
 * naive character count lets a description full of multi-byte
 * characters produce lines that strict parsers reject. Folding also
 * must not split a multi-byte sequence, hence the per-codepoint walk
 * rather than a slice.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) {
    return line;
  }

  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  // Continuation lines start with a space, which itself counts toward
  // the octet budget.
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += size;
  }
  if (current !== "") {
    out.push(current);
  }

  return out.join("\r\n ");
}

/** `20260506T180000` — a local timestamp, for use with a TZID. */
function localStamp(instant: Temporal.Instant): string {
  const zoned = instant.toZonedDateTimeISO(CLUB_TIME_ZONE);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(zoned.year, 4)}${pad(zoned.month)}${pad(zoned.day)}T${pad(zoned.hour)}${pad(zoned.minute)}${pad(zoned.second)}`;
}

/** `20260506T220000Z` — a UTC timestamp, for DTSTAMP and friends. */
function utcStamp(instant: Temporal.Instant): string {
  const zoned = instant.toZonedDateTimeISO("UTC");
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(zoned.year, 4)}${pad(zoned.month)}${pad(zoned.day)}T${pad(zoned.hour)}${pad(zoned.minute)}${pad(zoned.second)}Z`;
}

/** The club-local date one calendar day after an instant's. */
function nextDateStamp(instant: Temporal.Instant): string {
  const date = instant
    .toZonedDateTimeISO(CLUB_TIME_ZONE)
    .toPlainDate()
    .add({ days: 1 });
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.year}${pad(date.month)}${pad(date.day)}`;
}

/** `20260506` — a date value, for an all-day event. */
function dateStamp(instant: Temporal.Instant): string {
  const zoned = instant.toZonedDateTimeISO(CLUB_TIME_ZONE);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${zoned.year}${pad(zoned.month)}${pad(zoned.day)}`;
}

/** The stable UID for a series. Derived from `public_id`, forever. */
export function eventUid(publicId: string): string {
  return `${publicId}@${UID_DOMAIN}`;
}

/**
 * One VEVENT.
 *
 * **Recurring series are emitted once, carrying their RRULE**, rather
 * than expanded into one VEVENT per occurrence. That is what the format
 * is for: clients expand it themselves, the file stays small, and — the
 * real reason — an expanded feed has a horizon, so a member who
 * subscribes and never opens the site again silently stops seeing the
 * weekly meeting the day the horizon passes.
 */
function renderEvent(occurrence: CalendarOccurrence, now: Temporal.Instant) {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${eventUid(occurrence.publicId)}`,
    `DTSTAMP:${utcStamp(now)}`,
    `SEQUENCE:${occurrence.sequence}`,
  ];

  if (occurrence.allDay) {
    // DATE values are floating by definition — an all-day event has no
    // time and therefore no zone. Giving one a TZID is a spec
    // violation that some clients render as midnight-to-midnight in
    // the wrong zone.
    lines.push(`DTSTART;VALUE=DATE:${dateStamp(occurrence.startsAt)}`);
    const end = occurrence.endsAt ?? occurrence.startsAt;
    // DTEND is exclusive for DATE values, so a one-day event ends on
    // the following day. Omitting the +1 makes every all-day event
    // render as zero-length and vanish from some month views.
    // **The +1 is a CALENDAR day, not 24 hours.** On the November
    // fall-back day the club-local day is 25 hours long, so adding 24h
    // to midnight lands at 23:00 on the *same* date and the event
    // collapses to zero length on exactly one day a year.
    lines.push(`DTEND;VALUE=DATE:${nextDateStamp(end)}`);
  } else {
    lines.push(
      `DTSTART;TZID=${CLUB_TIME_ZONE}:${localStamp(occurrence.startsAt)}`,
    );
    if (occurrence.endsAt !== null) {
      lines.push(
        `DTEND;TZID=${CLUB_TIME_ZONE}:${localStamp(occurrence.endsAt)}`,
      );
    }
  }

  if (occurrence.rrule !== null) {
    lines.push(`RRULE:${occurrence.rrule}`);
  }

  lines.push(`SUMMARY:${escapeText(occurrence.title)}`);
  if (occurrence.description !== null) {
    lines.push(`DESCRIPTION:${escapeText(occurrence.description)}`);
  }
  if (occurrence.location !== null) {
    lines.push(`LOCATION:${escapeText(occurrence.location)}`);
  }
  lines.push(`CATEGORIES:${occurrence.kind.toUpperCase()}`);
  lines.push(`STATUS:${occurrence.canceled ? "CANCELLED" : "CONFIRMED"}`);
  lines.push("END:VEVENT");

  return lines;
}

/**
 * One EXDATE line per skipped occurrence of a series.
 *
 * Grouped into a single property rather than one per date, which is
 * what RFC 5545 prefers and what keeps a semester of cancellations from
 * adding thirty lines.
 */
function renderExdates(
  dates: readonly Temporal.Instant[],
  allDay: boolean,
): string[] {
  if (dates.length === 0) {
    return [];
  }
  // **The value type has to match DTSTART** (RFC 5545 §3.8.5.1). An
  // all-day series carries `DTSTART;VALUE=DATE`, so its EXDATEs must be
  // DATE values too — a TZID date-time against a DATE start is
  // discarded by most clients, which leaves a skipped day still showing
  // on every subscriber's phone while the website hides it.
  if (allDay) {
    return [`EXDATE;VALUE=DATE:${dates.map(dateStamp).join(",")}`];
  }
  return [`EXDATE;TZID=${CLUB_TIME_ZONE}:${dates.map(localStamp).join(",")}`];
}

/** `RECURRENCE-ID`, likewise matching DTSTART's value type. */
function recurrenceIdLine(
  occurrenceStart: Temporal.Instant,
  allDay: boolean,
): string {
  return allDay
    ? `RECURRENCE-ID;VALUE=DATE:${dateStamp(occurrenceStart)}`
    : `RECURRENCE-ID;TZID=${CLUB_TIME_ZONE}:${localStamp(occurrenceStart)}`;
}

export interface IcalSeries {
  /** The series itself, with its RRULE if it has one. */
  readonly series: CalendarOccurrence;
  /** Occurrence starts to skip, as EXDATE. */
  readonly exdates: readonly Temporal.Instant[];
  /** Occurrences that differ from the series, as RECURRENCE-ID events. */
  readonly overrides: readonly CalendarOccurrence[];
}

/**
 * Render a whole calendar.
 *
 * `METHOD:PUBLISH` and `X-PUBLISHED-TTL` tell clients this is a
 * read-only subscription and roughly how often to poll. Neither is
 * binding — Google in particular polls on its own schedule, sometimes
 * only every few hours — which is why the page says so rather than
 * promising members their phone updates instantly.
 */
export function renderCalendar(
  entries: readonly IcalSeries[],
  calendarName: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-WR-TIMEZONE:${CLUB_TIME_ZONE}`,
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ...VTIMEZONE,
  ];

  for (const entry of entries) {
    const event = renderEvent(entry.series, now);
    // EXDATE belongs inside the VEVENT it modifies, before END:VEVENT.
    event.splice(
      event.length - 1,
      0,
      ...renderExdates(entry.exdates, entry.series.allDay),
    );
    lines.push(...event);

    for (const override of entry.overrides) {
      const overrideLines = renderEvent(override, now);
      // An override is the same UID with a RECURRENCE-ID naming the
      // slot it replaces, and it must NOT carry the series' RRULE or
      // the client reads it as a second infinite series.
      const withoutRule = overrideLines.filter(
        (line) => !line.startsWith("RRULE:"),
      );
      withoutRule.splice(
        1,
        0,
        recurrenceIdLine(override.occurrenceStart, override.allDay),
      );
      lines.push(...withoutRule);
    }
  }

  lines.push("END:VCALENDAR");

  // CRLF line endings are required by RFC 5545 §3.1, and the trailing
  // one is too — some parsers drop a final line without it.
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
