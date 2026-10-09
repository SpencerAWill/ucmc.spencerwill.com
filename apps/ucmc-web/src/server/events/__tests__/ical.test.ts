import { describe, expect, it } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import { eventUid, foldLine, renderCalendar } from "#/server/events/ical";
import type { IcalSeries } from "#/server/events/ical";
import type { CalendarOccurrence } from "#/server/events/occurrences";

/**
 * iCalendar output.
 *
 * Almost every bug available here is invisible locally and shows up as
 * "my phone has forty copies of the weekly meeting" or "the edit never
 * arrived" a week later, so these assert the specific bytes rather than
 * that something plausible came out.
 */

function clubLocal(local: string): Temporal.Instant {
  return Temporal.PlainDateTime.from(local)
    .toZonedDateTime(CLUB_TIME_ZONE)
    .toInstant();
}

const NOW = Temporal.Instant.from("2026-05-01T12:00:00Z");

function occurrence(
  overrides: Partial<CalendarOccurrence> = {},
): CalendarOccurrence {
  const startsAt = clubLocal("2026-05-06T18:00");
  return {
    eventId: "evt_1",
    publicId: "abc123def456",
    occurrenceStart: startsAt,
    startsAt,
    endsAt: clubLocal("2026-05-06T19:00"),
    allDay: false,
    title: "Weekly meeting",
    description: null,
    location: null,
    kind: "meeting",
    visibility: "members",
    rrule: null,
    seriesStartsAt: startsAt,
    seriesEndsAt: null,
    seriesCanceled: false,
    occurrenceCanceled: false,
    canceled: false,
    sequence: 0,
    updatedAt: startsAt,
    ...overrides,
  };
}

function render(entries: IcalSeries[]): string {
  return renderCalendar(entries, "UCMC", NOW);
}

function one(overrides: Partial<CalendarOccurrence> = {}): string {
  return render([
    { series: occurrence(overrides), exdates: [], overrides: [] },
  ]);
}

describe("calendar envelope", () => {
  it("opens and closes a VCALENDAR with the required properties", () => {
    const ics = one();
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("CALSCALE:GREGORIAN");
    expect(ics).toContain("METHOD:PUBLISH");
  });

  /** RFC 5545 §3.1 requires CRLF, including on the final line. */
  it("uses CRLF line endings throughout", () => {
    const ics = one();
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  /**
   * Without a VTIMEZONE to resolve the TZID against, clients fall back
   * to guessing — and render half the year an hour off.
   */
  it("carries a VTIMEZONE matching the TZID it uses", () => {
    const ics = one();
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain(`TZID:${CLUB_TIME_ZONE}`);
    expect(ics).toContain("TZOFFSETTO:-0400");
    expect(ics).toContain("TZOFFSETTO:-0500");
    expect(ics).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU");
    expect(ics).toContain("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU");
    expect(ics).toContain("END:VTIMEZONE");
  });
});

describe("VEVENT identity", () => {
  /**
   * The single most consequential line in the file. A UID that changes
   * between polls makes clients treat each poll's events as new, so a
   * member accrues one copy of the weekly meeting per poll forever.
   */
  it("derives UID from the public id and nothing else", () => {
    expect(eventUid("abc123def456")).toBe("abc123def456@ucmc.spencerwill.com");
    expect(one()).toContain("UID:abc123def456@ucmc.spencerwill.com");
  });

  it("emits the same UID on every render", () => {
    expect(one()).toBe(one());
  });

  /**
   * Clients ignore an incoming VEVENT that doesn't beat the SEQUENCE
   * they hold, so a stale one means edits silently never appear.
   */
  it("emits SEQUENCE verbatim", () => {
    expect(one({ sequence: 0 })).toContain("SEQUENCE:0");
    expect(one({ sequence: 7 })).toContain("SEQUENCE:7");
  });
});

describe("timestamps", () => {
  it("emits DTSTART and DTEND as local times with an explicit TZID", () => {
    const ics = one();
    expect(ics).toContain(`DTSTART;TZID=${CLUB_TIME_ZONE}:20260506T180000`);
    expect(ics).toContain(`DTEND;TZID=${CLUB_TIME_ZONE}:20260506T190000`);
  });

  /**
   * The local stamp must be the CLUB's wall clock, not UTC's. A naive
   * UTC render of this event would read 22:00.
   */
  it("renders club wall time, not UTC", () => {
    expect(one()).not.toContain(
      "DTSTART;TZID=America/New_York:20260506T220000",
    );
  });

  it("keeps the same wall time on the far side of a DST transition", () => {
    const ics = one({
      startsAt: clubLocal("2026-11-04T18:00"),
      endsAt: clubLocal("2026-11-04T19:00"),
    });
    expect(ics).toContain(`DTSTART;TZID=${CLUB_TIME_ZONE}:20261104T180000`);
  });

  it("omits DTEND for a point-in-time event", () => {
    expect(one({ endsAt: null })).not.toContain("DTEND");
  });

  it("emits DTSTAMP as a UTC stamp", () => {
    expect(one()).toContain("DTSTAMP:20260501T120000Z");
  });
});

describe("all-day events", () => {
  /**
   * A DATE value is floating by definition. Attaching a TZID is a spec
   * violation that some clients render as midnight-to-midnight in the
   * wrong zone.
   */
  it("emits DATE values with no TZID", () => {
    const ics = one({
      allDay: true,
      startsAt: clubLocal("2026-05-06T00:00"),
      endsAt: null,
    });
    expect(ics).toContain("DTSTART;VALUE=DATE:20260506");
    expect(ics).not.toContain("DTSTART;TZID=America/New_York:20260506");
  });

  /**
   * DTEND is exclusive for DATE values, so a one-day event ends on the
   * following day. Without the +1 every all-day event is zero-length
   * and disappears from some month views.
   */
  it("makes DTEND exclusive", () => {
    const ics = one({
      allDay: true,
      startsAt: clubLocal("2026-05-06T00:00"),
      endsAt: null,
    });
    expect(ics).toContain("DTEND;VALUE=DATE:20260507");
  });

  /**
   * The exclusive end is a CALENDAR day later, not 24 hours later. The
   * club-local day of the November fall-back is 25 hours long, so a
   * `+24h` on the instant lands at 23:00 on the *same* date and the
   * event collapses to zero length on exactly one day a year — which
   * the May-dated test above cannot see.
   */
  it("stays one day long on the fall-back day", () => {
    const ics = one({
      allDay: true,
      startsAt: clubLocal("2026-11-01T00:00"),
      endsAt: null,
    });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261101");
    expect(ics).toContain("DTEND;VALUE=DATE:20261102");
  });

  it("stays one day long on the spring-forward day", () => {
    const ics = one({
      allDay: true,
      startsAt: clubLocal("2026-03-08T00:00"),
      endsAt: null,
    });
    expect(ics).toContain("DTEND;VALUE=DATE:20260309");
  });

  /**
   * RFC 5545 §3.8.5.1: EXDATE must use the same value type as DTSTART.
   * A TZID date-time against a `VALUE=DATE` start is discarded by most
   * clients, so the skipped day would keep showing on every
   * subscriber's phone while the website hid it.
   */
  it("emits EXDATE as a DATE value for an all-day series", () => {
    const ics = render([
      {
        series: occurrence({
          allDay: true,
          startsAt: clubLocal("2026-05-06T00:00"),
          endsAt: null,
          rrule: "FREQ=WEEKLY;BYDAY=WE",
        }),
        exdates: [clubLocal("2026-05-13T00:00")],
        overrides: [],
      },
    ]);
    expect(ics).toContain("EXDATE;VALUE=DATE:20260513");
    expect(ics).not.toContain("EXDATE;TZID=");
  });

  it("emits RECURRENCE-ID as a DATE value for an all-day series", () => {
    const ics = render([
      {
        series: occurrence({
          allDay: true,
          startsAt: clubLocal("2026-05-06T00:00"),
          endsAt: null,
          rrule: "FREQ=WEEKLY;BYDAY=WE",
        }),
        exdates: [],
        overrides: [
          occurrence({
            allDay: true,
            rrule: null,
            occurrenceStart: clubLocal("2026-05-13T00:00"),
            startsAt: clubLocal("2026-05-14T00:00"),
            endsAt: null,
          }),
        ],
      },
    ]);
    expect(ics).toContain("RECURRENCE-ID;VALUE=DATE:20260513");
    expect(ics).not.toContain("RECURRENCE-ID;TZID=");
  });

  /** Timed series keep the TZID form. */
  it("keeps EXDATE as a TZID date-time for a timed series", () => {
    const ics = render([
      {
        series: occurrence({ rrule: "FREQ=WEEKLY;BYDAY=WE" }),
        exdates: [clubLocal("2026-05-13T18:00")],
        overrides: [],
      },
    ]);
    expect(ics).toContain(`EXDATE;TZID=${CLUB_TIME_ZONE}:20260513T180000`);
  });
});

describe("recurrence", () => {
  /**
   * Series are emitted once with their rule, not expanded. An expanded
   * feed has a horizon, so a member who subscribes and never returns
   * silently stops seeing the weekly meeting the day it passes.
   */
  it("emits the RRULE rather than expanded occurrences", () => {
    const ics = one({ rrule: "FREQ=WEEKLY;BYDAY=WE" });
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=WE");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("groups skipped occurrences into one EXDATE", () => {
    const ics = render([
      {
        series: occurrence({ rrule: "FREQ=WEEKLY;BYDAY=WE" }),
        exdates: [clubLocal("2026-05-13T18:00"), clubLocal("2026-05-20T18:00")],
        overrides: [],
      },
    ]);
    expect(ics).toContain(
      `EXDATE;TZID=${CLUB_TIME_ZONE}:20260513T180000,20260520T180000`,
    );
    expect(ics.match(/EXDATE/g)).toHaveLength(1);
  });

  it("puts EXDATE inside the VEVENT it modifies", () => {
    const ics = render([
      {
        series: occurrence({ rrule: "FREQ=WEEKLY;BYDAY=WE" }),
        exdates: [clubLocal("2026-05-13T18:00")],
        overrides: [],
      },
    ]);
    const body = ics.slice(ics.indexOf("BEGIN:VEVENT"));
    expect(body.indexOf("EXDATE")).toBeLessThan(body.indexOf("END:VEVENT"));
  });

  it("emits no EXDATE when nothing is skipped", () => {
    expect(one({ rrule: "FREQ=WEEKLY" })).not.toContain("EXDATE");
  });
});

describe("occurrence overrides", () => {
  const overridden = render([
    {
      series: occurrence({ rrule: "FREQ=WEEKLY;BYDAY=WE" }),
      exdates: [],
      overrides: [
        occurrence({
          rrule: null,
          occurrenceStart: clubLocal("2026-05-13T18:00"),
          startsAt: clubLocal("2026-05-13T20:00"),
          endsAt: clubLocal("2026-05-13T21:00"),
          title: "In the gym this week",
          sequence: 3,
        }),
      ],
    },
  ]);

  it("names the slot it replaces with RECURRENCE-ID", () => {
    expect(overridden).toContain(
      `RECURRENCE-ID;TZID=${CLUB_TIME_ZONE}:20260513T180000`,
    );
  });

  it("shares the series UID", () => {
    expect(
      overridden.match(/UID:abc123def456@ucmc\.spencerwill\.com/g),
    ).toHaveLength(2);
  });

  /**
   * An override carrying the series' RRULE would be read as a second
   * infinite series — the event then appears twice a week forever.
   */
  it("does not repeat the series RRULE on the override", () => {
    expect(overridden.match(/RRULE:FREQ=WEEKLY;BYDAY=WE/g)).toHaveLength(1);
  });

  it("carries the override's own start and title", () => {
    expect(overridden).toContain(
      `DTSTART;TZID=${CLUB_TIME_ZONE}:20260513T200000`,
    );
    expect(overridden).toContain("SUMMARY:In the gym this week");
  });
});

describe("cancellation", () => {
  /**
   * A cancelled event has to be PUBLISHED as cancelled. A row that
   * merely stops being emitted reads to most clients as "no change",
   * and the event stays on the subscriber's phone indefinitely.
   */
  it("emits STATUS:CANCELLED rather than omitting the event", () => {
    const ics = one({ canceled: true });
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("BEGIN:VEVENT");
  });

  it("emits STATUS:CONFIRMED otherwise", () => {
    expect(one()).toContain("STATUS:CONFIRMED");
  });
});

describe("text escaping", () => {
  // Written with String.raw throughout: these assertions are entirely
  // about how many backslashes come out, and ordinary string literals
  // make that unreadable and easy to get wrong in the test rather than
  // in the code.
  it("escapes semicolons, commas, backslashes and newlines", () => {
    const ics = one({
      title: "Gear night; bring boots, rope",
      description: "Line one\nLine two",
      location: String.raw`C:\Climbing`,
    });
    expect(ics).toContain(String.raw`SUMMARY:Gear night\; bring boots\, rope`);
    expect(ics).toContain(String.raw`DESCRIPTION:Line one\nLine two`);
    expect(ics).toContain(String.raw`LOCATION:C:\\Climbing`);
  });

  /**
   * Backslash has to be escaped FIRST. Doing it after the others would
   * double-escape the backslashes the other replacements introduce, so
   * a title containing a semicolon would emit a literal backslash
   * followed by an UNESCAPED semicolon — which splits the property and
   * corrupts the event.
   *
   * Built from an explicit \u005c rather than written as literal
   * backslashes: the assertion is entirely about how many of them come
   * out, and that is the one thing a string literal renders unreadable.
   * This caught a real bug — `escapeText` had `"\\;"` written as `"\;"`,
   * which JavaScript reads as a bare `;`, so semicolons were never
   * escaped at all.
   */
  it("escapes a backslash before a semicolon, not after", () => {
    const bs = "\u005c";
    // `a\;b` -> the backslash doubles, then the semicolon gains one.
    expect(one({ title: `a${bs};b` })).toContain(`SUMMARY:a${bs}${bs}${bs};b`);
  });

  it("escapes a lone semicolon", () => {
    const bs = "\u005c";
    expect(one({ title: "a;b" })).toContain(`SUMMARY:a${bs};b`);
  });

  it("leaves ordinary text untouched", () => {
    expect(one({ title: "Gear night" })).toContain("SUMMARY:Gear night");
  });
});

describe("foldLine", () => {
  it("leaves a short line alone", () => {
    expect(foldLine("SUMMARY:Short")).toBe("SUMMARY:Short");
  });

  it("folds a long line with a leading space on continuations", () => {
    const folded = foldLine(`SUMMARY:${"x".repeat(200)}`);
    expect(folded).toContain("\r\n ");
    for (const line of folded.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("unfolds back to the original content", () => {
    const original = `SUMMARY:${"abcde ".repeat(40)}`;
    expect(foldLine(original).replace(/\r\n /g, "")).toBe(original);
  });

  /**
   * The limit is octets, not characters. A description of multi-byte
   * characters passes a naive character count while producing lines
   * strict parsers reject — and folding must never split a multi-byte
   * sequence.
   */
  it("measures octets and never splits a multi-byte character", () => {
    const original = `SUMMARY:${"é".repeat(80)}`;
    const folded = foldLine(original);
    for (const line of folded.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(original);
  });

  it("folds emoji without corrupting them", () => {
    const original = `SUMMARY:${"🧗".repeat(40)}`;
    expect(foldLine(original).replace(/\r\n /g, "")).toBe(original);
  });
});

describe("metadata", () => {
  it("names the calendar and its zone", () => {
    const ics = renderCalendar(
      [{ series: occurrence(), exdates: [], overrides: [] }],
      "UCMC (my calendar)",
      NOW,
    );
    expect(ics).toContain("X-WR-CALNAME:UCMC (my calendar)");
    expect(ics).toContain(`X-WR-TIMEZONE:${CLUB_TIME_ZONE}`);
  });

  it("tags the event with its kind", () => {
    expect(one({ kind: "trip" })).toContain("CATEGORIES:TRIP");
  });

  it("renders an empty calendar without events", () => {
    const ics = render([]);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
