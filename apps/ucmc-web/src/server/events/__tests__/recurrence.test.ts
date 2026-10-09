import { describe, expect, it } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import {
  RecurrenceError,
  expandOccurrences,
  formatRrule,
  normalizeRrule,
  parseRrule,
} from "#/server/events/recurrence";

/**
 * The recurrence subset and its expander.
 *
 * The centrepiece is DST. The club zone observes it, the worker runs
 * UTC, and a weekly meeting is the one thing on this calendar that
 * crosses a transition twice a year — so "18:00 stays 18:00" is the
 * property the whole module exists to hold. The elapsed-time
 * alternative passes every test that does not span March or November,
 * which is exactly why these are written against those two months.
 */

/** An instant from club-local wall time, the way an officer enters it. */
function clubLocal(local: string): Temporal.Instant {
  return Temporal.PlainDateTime.from(local)
    .toZonedDateTime(CLUB_TIME_ZONE)
    .toInstant();
}

/** Club-local wall time of an instant, for asserting what a member sees. */
function wallTime(instant: Temporal.Instant): string {
  return instant
    .toZonedDateTimeISO(CLUB_TIME_ZONE)
    .toPlainDateTime()
    .toString();
}

describe("parseRrule", () => {
  it("parses a weekly rule with defaults filled in", () => {
    expect(parseRrule("FREQ=WEEKLY;BYDAY=WE")).toEqual({
      freq: "WEEKLY",
      interval: 1,
      byDay: [{ ordinal: null, weekday: "WE" }],
      until: null,
      count: null,
    });
  });

  it("accepts the RRULE: prefix an officer gets from another calendar", () => {
    expect(parseRrule("RRULE:FREQ=WEEKLY").freq).toBe("WEEKLY");
  });

  it("parses UNTIL as a UTC instant", () => {
    const rule = parseRrule("FREQ=WEEKLY;UNTIL=20260408T233000Z");
    expect(rule.until?.toString()).toBe("2026-04-08T23:30:00Z");
  });

  it("parses a monthly ordinal BYDAY", () => {
    expect(parseRrule("FREQ=MONTHLY;BYDAY=2WE").byDay).toEqual([
      { ordinal: 2, weekday: "WE" },
    ]);
    expect(parseRrule("FREQ=MONTHLY;BYDAY=-1FR").byDay).toEqual([
      { ordinal: -1, weekday: "FR" },
    ]);
  });

  /**
   * Each of these is rejected rather than ignored. Silently dropping a
   * component we do not implement would give the feed and the page
   * different occurrence sets — the member's phone and the website each
   * confidently wrong in a different way, with nothing to notice it.
   */
  it.each([
    ["", "empty"],
    ["FREQ=DAILY", "unsupported frequency"],
    ["FREQ=YEARLY", "unsupported frequency"],
    ["BYDAY=WE", "missing FREQ"],
    ["FREQ=WEEKLY;BYMONTH=3", "unsupported component"],
    ["FREQ=WEEKLY;BYSETPOS=1", "unsupported component"],
    ["FREQ=WEEKLY;WKST=SU", "unsupported component"],
    ["FREQ=WEEKLY;COUNT=5;UNTIL=20260408T233000Z", "COUNT and UNTIL together"],
    ["FREQ=WEEKLY;INTERVAL=0", "interval below range"],
    ["FREQ=WEEKLY;INTERVAL=x", "non-numeric interval"],
    ["FREQ=WEEKLY;COUNT=0", "count below range"],
    ["FREQ=WEEKLY;BYDAY=2WE", "ordinal under weekly"],
    ["FREQ=MONTHLY;BYDAY=0WE", "zero ordinal"],
    // Valid RFC 5545 we do not implement. Accepting it let the expander
    // fall back to day-of-month while the feed emitted the rule
    // verbatim — the page saying "the 14th" and every subscriber's
    // client saying "every Wednesday".
    ["FREQ=MONTHLY;BYDAY=WE", "bare weekday under monthly"],
    ["FREQ=MONTHLY;BYDAY=6WE", "ordinal out of range"],
    ["FREQ=WEEKLY;BYDAY=XX", "not a weekday"],
    ["FREQ=WEEKLY;UNTIL=2026-04-08", "UNTIL not in UTC stamp form"],
    ["FREQ=WEEKLY;FREQ=MONTHLY", "duplicate component"],
    ["FREQ=WEEKLY;NOPE", "malformed segment"],
  ])("rejects %j (%s)", (input) => {
    expect(() => parseRrule(input)).toThrow(RecurrenceError);
  });
});

describe("formatRrule", () => {
  it("omits INTERVAL=1 and emits components in RFC order", () => {
    expect(formatRrule(parseRrule("BYDAY=WE;FREQ=WEEKLY"))).toBe(
      "FREQ=WEEKLY;BYDAY=WE",
    );
  });

  it("round-trips UNTIL through the UTC stamp form", () => {
    expect(normalizeRrule("FREQ=WEEKLY;UNTIL=20260408T233000Z")).toBe(
      "FREQ=WEEKLY;UNTIL=20260408T233000Z",
    );
  });

  it("normalizes case and the RRULE: prefix", () => {
    expect(normalizeRrule("rrule:freq=weekly;byday=mo,we")).toBe(
      "FREQ=WEEKLY;BYDAY=MO,WE",
    );
  });

  it("keeps a non-default INTERVAL", () => {
    expect(normalizeRrule("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU")).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU",
    );
  });
});

describe("expandOccurrences — DST", () => {
  /**
   * The club's weekly meeting, 18:00–19:00 Wednesdays, expanded across
   * the November transition. Every occurrence must read 18:00 local.
   *
   * Under elapsed-time arithmetic the occurrences after the first
   * Sunday in November land at 17:00 local, because the week containing
   * the transition is 169 hours rather than 168. That is the bug this
   * whole module is shaped to avoid.
   */
  it("holds 18:00 local across the fall-back transition", () => {
    const series = {
      startsAt: clubLocal("2026-10-21T18:00"),
      endsAt: clubLocal("2026-10-21T19:00"),
      rrule: "FREQ=WEEKLY;BYDAY=WE",
    };
    const occurrences = expandOccurrences(
      series,
      clubLocal("2026-10-01T00:00"),
      clubLocal("2026-11-30T00:00"),
    );

    // 2026's transition is Sunday Nov 1, so the Oct 28 meeting is EDT
    // and the Nov 4 meeting is EST.
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      "2026-10-21T18:00:00",
      "2026-10-28T18:00:00",
      "2026-11-04T18:00:00",
      "2026-11-11T18:00:00",
      "2026-11-18T18:00:00",
      "2026-11-25T18:00:00",
    ]);
  });

  it("holds 18:00 local across the spring-forward transition", () => {
    const series = {
      startsAt: clubLocal("2026-03-04T18:00"),
      endsAt: clubLocal("2026-03-04T19:00"),
      rrule: "FREQ=WEEKLY;BYDAY=WE",
    };
    const occurrences = expandOccurrences(
      series,
      clubLocal("2026-03-01T00:00"),
      clubLocal("2026-03-26T00:00"),
    );

    // 2026's spring transition is Sunday Mar 8.
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      "2026-03-04T18:00:00",
      "2026-03-11T18:00:00",
      "2026-03-18T18:00:00",
      "2026-03-25T18:00:00",
    ]);
  });

  /**
   * The UTC offset really does change underneath those occurrences —
   * without this, a `CLUB_TIME_ZONE` that had quietly become UTC would
   * still pass the two tests above.
   */
  it("shifts the underlying instant by the offset change", () => {
    const occurrences = expandOccurrences(
      {
        startsAt: clubLocal("2026-10-28T18:00"),
        endsAt: null,
        rrule: "FREQ=WEEKLY;BYDAY=WE",
      },
      clubLocal("2026-10-01T00:00"),
      clubLocal("2026-11-10T00:00"),
    );
    expect(occurrences.map((o) => o.startsAt.toString())).toEqual([
      // EDT, UTC-4.
      "2026-10-28T22:00:00Z",
      // EST, UTC-5 — an hour later in UTC for the same local time.
      "2026-11-04T23:00:00Z",
    ]);
  });

  it("preserves wall-clock duration rather than elapsed hours", () => {
    const [occurrence] = expandOccurrences(
      {
        startsAt: clubLocal("2026-10-28T18:00"),
        endsAt: clubLocal("2026-10-28T19:00"),
        rrule: "FREQ=WEEKLY;BYDAY=WE",
      },
      clubLocal("2026-11-01T00:00"),
      clubLocal("2026-11-10T00:00"),
    );
    expect(wallTime(occurrence.startsAt)).toBe("2026-11-04T18:00:00");
    expect(wallTime(occurrence.endsAt!)).toBe("2026-11-04T19:00:00");
  });

  /**
   * The test above does NOT actually test its own name: 18:00–19:00 on
   * Nov 4 is nowhere near a transition, so it passes under exact-elapsed
   * arithmetic too. This one spans the fall-back hour itself, which is
   * the only place the two diverge — under exact-elapsed the end came
   * back as 01:30, i.e. the event displayed as 1:30 – 1:30.
   */
  it("holds the local end time for an occurrence spanning the repeated hour", () => {
    const [occurrence] = expandOccurrences(
      {
        startsAt: clubLocal("2026-10-25T01:30"),
        endsAt: clubLocal("2026-10-25T02:30"),
        rrule: "FREQ=WEEKLY;BYDAY=SU",
      },
      clubLocal("2026-11-01T00:00"),
      clubLocal("2026-11-02T00:00"),
    );
    expect(wallTime(occurrence.startsAt)).toBe("2026-11-01T01:30:00");
    expect(wallTime(occurrence.endsAt!)).toBe("2026-11-01T02:30:00");
  });

  /** The spring counterpart: the hour that does not exist. */
  it("holds the local end time across the spring-forward gap", () => {
    const [occurrence] = expandOccurrences(
      {
        startsAt: clubLocal("2026-03-01T01:30"),
        endsAt: clubLocal("2026-03-01T03:30"),
        rrule: "FREQ=WEEKLY;BYDAY=SU",
      },
      clubLocal("2026-03-08T00:00"),
      clubLocal("2026-03-09T00:00"),
    );
    expect(wallTime(occurrence.startsAt)).toBe("2026-03-08T01:30:00");
    expect(wallTime(occurrence.endsAt!)).toBe("2026-03-08T03:30:00");
  });
});

describe("expandOccurrences — weekly", () => {
  it("returns a non-recurring series as a single occurrence", () => {
    const series = {
      startsAt: clubLocal("2026-05-02T09:00"),
      endsAt: clubLocal("2026-05-02T17:00"),
      rrule: null,
    };
    const occurrences = expandOccurrences(
      series,
      clubLocal("2026-05-01T00:00"),
      clubLocal("2026-06-01T00:00"),
    );
    expect(occurrences).toHaveLength(1);
    expect(wallTime(occurrences[0].startsAt)).toBe("2026-05-02T09:00:00");
  });

  it("omits a non-recurring series outside the window", () => {
    expect(
      expandOccurrences(
        {
          startsAt: clubLocal("2026-01-02T09:00"),
          endsAt: null,
          rrule: null,
        },
        clubLocal("2026-05-01T00:00"),
        clubLocal("2026-06-01T00:00"),
      ),
    ).toEqual([]);
  });

  it("defaults BYDAY to the anchor's own weekday", () => {
    const occurrences = expandOccurrences(
      {
        startsAt: clubLocal("2026-05-05T19:00"),
        endsAt: null,
        rrule: "FREQ=WEEKLY",
      },
      clubLocal("2026-05-01T00:00"),
      clubLocal("2026-05-31T00:00"),
    );
    // Anchor is a Tuesday.
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      "2026-05-05T19:00:00",
      "2026-05-12T19:00:00",
      "2026-05-19T19:00:00",
      "2026-05-26T19:00:00",
    ]);
  });

  it("emits every listed day in a multi-day rule", () => {
    const occurrences = expandOccurrences(
      {
        startsAt: clubLocal("2026-05-04T07:00"),
        endsAt: null,
        rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      },
      clubLocal("2026-05-01T00:00"),
      clubLocal("2026-05-16T00:00"),
    );
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      "2026-05-04T07:00:00",
      "2026-05-06T07:00:00",
      "2026-05-08T07:00:00",
      "2026-05-11T07:00:00",
      "2026-05-13T07:00:00",
      "2026-05-15T07:00:00",
    ]);
  });

  /**
   * WKST defaults to Monday, so INTERVAL=2 steps from the Monday on or
   * before the anchor. Stepping from the anchor's own weekday instead
   * puts MO and WE in different fortnights whenever the anchor is not
   * itself a Monday — which is the shape a "every other week, Mon and
   * Wed" officer schedule actually takes.
   */
  it("steps fortnightly from the week start, not from the anchor's weekday", () => {
    const occurrences = expandOccurrences(
      {
        // A Wednesday.
        startsAt: clubLocal("2026-05-06T18:00"),
        endsAt: null,
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE",
      },
      clubLocal("2026-05-01T00:00"),
      clubLocal("2026-06-05T00:00"),
    );
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      // Mon May 4 precedes the anchor and is skipped; its Wednesday is
      // the anchor itself.
      "2026-05-06T18:00:00",
      // Skip the week of May 11; resume the week of May 18.
      "2026-05-18T18:00:00",
      "2026-05-20T18:00:00",
      "2026-06-01T18:00:00",
      "2026-06-03T18:00:00",
    ]);
  });

  it("never emits an occurrence before the anchor", () => {
    const occurrences = expandOccurrences(
      {
        // Friday; the rule also names Monday, which falls earlier that week.
        startsAt: clubLocal("2026-05-08T12:00"),
        endsAt: null,
        rrule: "FREQ=WEEKLY;BYDAY=MO,FR",
      },
      clubLocal("2026-05-01T00:00"),
      clubLocal("2026-05-20T00:00"),
    );
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      "2026-05-08T12:00:00",
      "2026-05-11T12:00:00",
      "2026-05-15T12:00:00",
      "2026-05-18T12:00:00",
    ]);
  });
});

describe("expandOccurrences — bounds", () => {
  it("stops at UNTIL, inclusive", () => {
    const occurrences = expandOccurrences(
      {
        startsAt: clubLocal("2026-05-06T18:00"),
        endsAt: null,
        // 2026-05-20T18:00 EDT is 22:00Z.
        rrule: "FREQ=WEEKLY;BYDAY=WE;UNTIL=20260520T220000Z",
      },
      clubLocal("2026-05-01T00:00"),
      clubLocal("2026-07-01T00:00"),
    );
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      "2026-05-06T18:00:00",
      "2026-05-13T18:00:00",
      "2026-05-20T18:00:00",
    ]);
  });

  it("stops after COUNT occurrences", () => {
    const occurrences = expandOccurrences(
      {
        startsAt: clubLocal("2026-05-06T18:00"),
        endsAt: null,
        rrule: "FREQ=WEEKLY;BYDAY=WE;COUNT=3",
      },
      clubLocal("2026-05-01T00:00"),
      clubLocal("2026-07-01T00:00"),
    );
    expect(occurrences).toHaveLength(3);
  });

  /**
   * COUNT is a property of the series, not of the view. A window that
   * opens after the series has already run out must report nothing —
   * which means counting forward from the anchor rather than from the
   * window.
   */
  it("counts from the anchor, so a later window sees the series exhausted", () => {
    const series = {
      startsAt: clubLocal("2026-05-06T18:00"),
      endsAt: null,
      rrule: "FREQ=WEEKLY;BYDAY=WE;COUNT=3",
    };
    expect(
      expandOccurrences(
        series,
        clubLocal("2026-06-01T00:00"),
        clubLocal("2026-07-01T00:00"),
      ),
    ).toEqual([]);
  });

  it("reports the right slice when the window opens mid-series", () => {
    const occurrences = expandOccurrences(
      {
        startsAt: clubLocal("2026-05-06T18:00"),
        endsAt: null,
        rrule: "FREQ=WEEKLY;BYDAY=WE;COUNT=6",
      },
      clubLocal("2026-05-18T00:00"),
      clubLocal("2026-06-03T00:00"),
    );
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      "2026-05-20T18:00:00",
      "2026-05-27T18:00:00",
    ]);
  });

  it("includes an occurrence already in progress at the window start", () => {
    const occurrences = expandOccurrences(
      {
        startsAt: clubLocal("2026-05-06T18:00"),
        endsAt: clubLocal("2026-05-06T21:00"),
        rrule: "FREQ=WEEKLY;BYDAY=WE",
      },
      // Window opens an hour into the May 13 meeting.
      clubLocal("2026-05-13T19:00"),
      clubLocal("2026-05-14T00:00"),
    );
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      "2026-05-13T18:00:00",
    ]);
  });

  it("carries occurrenceStart as the generated slot", () => {
    const [occurrence] = expandOccurrences(
      {
        startsAt: clubLocal("2026-05-06T18:00"),
        endsAt: null,
        rrule: "FREQ=WEEKLY;BYDAY=WE",
      },
      clubLocal("2026-05-12T00:00"),
      clubLocal("2026-05-14T00:00"),
    );
    expect(occurrence.occurrenceStart.toString()).toBe(
      occurrence.startsAt.toString(),
    );
  });
});

describe("expandOccurrences — monthly", () => {
  it("repeats on the anchor's day of month", () => {
    const occurrences = expandOccurrences(
      {
        startsAt: clubLocal("2026-01-15T19:00"),
        endsAt: null,
        rrule: "FREQ=MONTHLY",
      },
      clubLocal("2026-01-01T00:00"),
      clubLocal("2026-05-01T00:00"),
    );
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      "2026-01-15T19:00:00",
      "2026-02-15T19:00:00",
      "2026-03-15T19:00:00",
      "2026-04-15T19:00:00",
    ]);
  });

  /**
   * RFC 5545 §3.3.10 skips invalid dates rather than clamping them.
   * Clamping would move "the 31st" to Feb 28 and back again, which
   * reads to a member as the event wandering.
   */
  it("skips months too short for the anchor's day", () => {
    const occurrences = expandOccurrences(
      {
        startsAt: clubLocal("2026-01-31T19:00"),
        endsAt: null,
        rrule: "FREQ=MONTHLY",
      },
      clubLocal("2026-01-01T00:00"),
      clubLocal("2026-05-01T00:00"),
    );
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      // February and April have no 31st, so both are skipped outright
      // rather than being pulled back to the 28th / 30th.
      "2026-01-31T19:00:00",
      "2026-03-31T19:00:00",
    ]);
  });

  it("resolves an nth-weekday rule", () => {
    const occurrences = expandOccurrences(
      {
        startsAt: clubLocal("2026-01-14T18:00"),
        endsAt: null,
        rrule: "FREQ=MONTHLY;BYDAY=2WE",
      },
      clubLocal("2026-01-01T00:00"),
      clubLocal("2026-04-01T00:00"),
    );
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      "2026-01-14T18:00:00",
      "2026-02-11T18:00:00",
      "2026-03-11T18:00:00",
    ]);
  });

  it("resolves a last-weekday rule", () => {
    const occurrences = expandOccurrences(
      {
        startsAt: clubLocal("2026-01-30T18:00"),
        endsAt: null,
        rrule: "FREQ=MONTHLY;BYDAY=-1FR",
      },
      clubLocal("2026-01-01T00:00"),
      clubLocal("2026-04-01T00:00"),
    );
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      "2026-01-30T18:00:00",
      "2026-02-27T18:00:00",
      "2026-03-27T18:00:00",
    ]);
  });

  it("honours INTERVAL on monthly rules", () => {
    const occurrences = expandOccurrences(
      {
        startsAt: clubLocal("2026-01-15T19:00"),
        endsAt: null,
        rrule: "FREQ=MONTHLY;INTERVAL=3",
      },
      clubLocal("2026-01-01T00:00"),
      clubLocal("2026-11-01T00:00"),
    );
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      "2026-01-15T19:00:00",
      "2026-04-15T19:00:00",
      "2026-07-15T19:00:00",
      "2026-10-15T19:00:00",
    ]);
  });
});
