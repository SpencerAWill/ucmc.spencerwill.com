import { describe, expect, it } from "vitest";

import {
  EMPTY_RECURRENCE,
  buildRrule,
  describeRecurrence,
  ordinalWeekdayOf,
  parseRruleToForm,
  toUntilStamp,
  weekdayOf,
} from "#/features/calendar/lib/recurrence-form";
import type { RecurrenceFormState } from "#/features/calendar/lib/recurrence-form";
import { CLUB_TIME_ZONE } from "#/config/time";
import { expandOccurrences, parseRrule } from "#/server/events/recurrence";

/** A Wednesday. */
const ANCHOR = Temporal.PlainDate.from("2026-05-13");

function form(
  overrides: Partial<RecurrenceFormState> = {},
): RecurrenceFormState {
  return { ...EMPTY_RECURRENCE, ...overrides };
}

describe("weekdayOf / ordinalWeekdayOf", () => {
  it("reads the weekday token", () => {
    expect(weekdayOf(ANCHOR)).toBe("WE");
    expect(weekdayOf(Temporal.PlainDate.from("2026-05-17"))).toBe("SU");
  });

  it("counts which ordinal of its weekday a date is", () => {
    expect(ordinalWeekdayOf(Temporal.PlainDate.from("2026-05-06"))).toBe(1);
    expect(ordinalWeekdayOf(ANCHOR)).toBe(2);
    expect(ordinalWeekdayOf(Temporal.PlainDate.from("2026-05-20"))).toBe(3);
  });

  /**
   * A 5th weekday answers -1 ("the last"), not 4. A literal `5WE`
   * series would skip most months; clamping to `4` instead produced a
   * rule that did not include the very date the officer created the
   * event for — the 4th Wednesday is already past, so the first
   * occurrence landed in the following month.
   */
  it("answers -1 for a fifth weekday", () => {
    expect(ordinalWeekdayOf(Temporal.PlainDate.from("2026-09-30"))).toBe(-1);
  });

  it("keeps a genuine fourth weekday as 4", () => {
    expect(ordinalWeekdayOf(Temporal.PlainDate.from("2026-05-27"))).toBe(4);
  });
});

describe("a monthly series anchored on a fifth weekday", () => {
  /**
   * The failure the clamp caused, end to end: the event must occur on
   * the day it was created for.
   */
  it("includes the anchor date itself", () => {
    // 2026-09-30 is the fifth Wednesday of September.
    const anchor = Temporal.PlainDate.from("2026-09-30");
    const rule = buildRrule(
      form({ mode: "monthly", monthlyMode: "nthWeekday" }),
      anchor,
    );
    expect(rule).toBe("FREQ=MONTHLY;BYDAY=-1WE");

    const occurrences = expandOccurrences(
      {
        startsAt: anchor
          .toPlainDateTime({ hour: 18 })
          .toZonedDateTime(CLUB_TIME_ZONE)
          .toInstant(),
        endsAt: null,
        rrule: rule,
      },
      anchor
        .toPlainDateTime({ hour: 0 })
        .toZonedDateTime(CLUB_TIME_ZONE)
        .toInstant(),
      Temporal.PlainDate.from("2026-12-01")
        .toPlainDateTime({ hour: 0 })
        .toZonedDateTime(CLUB_TIME_ZONE)
        .toInstant(),
    );
    expect(
      occurrences.map((o) =>
        o.startsAt.toZonedDateTimeISO(CLUB_TIME_ZONE).toPlainDate().toString(),
      ),
    ).toEqual(["2026-09-30", "2026-10-28", "2026-11-25"]);
  });

  it("describes itself as the last weekday", () => {
    expect(
      describeRecurrence(
        form({ mode: "monthly", monthlyMode: "nthWeekday" }),
        Temporal.PlainDate.from("2026-09-30"),
      ),
    ).toBe("Every month on the last Wednesday.");
  });

  it("describes a genuine fourth weekday as the fourth", () => {
    expect(
      describeRecurrence(
        form({ mode: "monthly", monthlyMode: "nthWeekday" }),
        Temporal.PlainDate.from("2026-05-27"),
      ),
    ).toBe("Every month on the fourth Wednesday.");
  });
});

describe("buildRrule", () => {
  it("returns null for a one-off", () => {
    expect(buildRrule(form({ mode: "none" }), ANCHOR)).toBeNull();
  });

  it("builds a plain weekly rule, leaving the weekday implicit", () => {
    expect(buildRrule(form({ mode: "weekly" }), ANCHOR)).toBe("FREQ=WEEKLY");
  });

  it("emits chosen weekdays in calendar order, not click order", () => {
    expect(
      buildRrule(
        form({ mode: "weekly", weekdays: ["FR", "MO", "WE"] }),
        ANCHOR,
      ),
    ).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  });

  it("omits INTERVAL=1 and keeps anything else", () => {
    expect(buildRrule(form({ mode: "weekly", interval: 1 }), ANCHOR)).toBe(
      "FREQ=WEEKLY",
    );
    expect(buildRrule(form({ mode: "weekly", interval: 2 }), ANCHOR)).toBe(
      "FREQ=WEEKLY;INTERVAL=2",
    );
  });

  it("builds a monthly day-of-month rule with no BYDAY", () => {
    expect(
      buildRrule(form({ mode: "monthly", monthlyMode: "dayOfMonth" }), ANCHOR),
    ).toBe("FREQ=MONTHLY");
  });

  it("derives the ordinal weekday from the anchor", () => {
    expect(
      buildRrule(form({ mode: "monthly", monthlyMode: "nthWeekday" }), ANCHOR),
    ).toBe("FREQ=MONTHLY;BYDAY=2WE");
  });

  it("emits COUNT when the officer bounds by occurrences", () => {
    expect(
      buildRrule(form({ mode: "weekly", endMode: "count", count: 8 }), ANCHOR),
    ).toBe("FREQ=WEEKLY;COUNT=8");
  });

  it("emits UNTIL when the officer bounds by date", () => {
    const rule = buildRrule(
      form({ mode: "weekly", endMode: "until", untilDate: "2026-05-20" }),
      ANCHOR,
    );
    expect(rule).toBe("FREQ=WEEKLY;UNTIL=20260521T035959Z");
  });

  it("ignores an empty until date rather than emitting a broken rule", () => {
    expect(
      buildRrule(
        form({ mode: "weekly", endMode: "until", untilDate: "" }),
        ANCHOR,
      ),
    ).toBe("FREQ=WEEKLY");
  });

  /**
   * Everything this builds has to survive the parser the server runs on
   * write — otherwise an officer can configure a repeat the form
   * accepts and the save rejects, with nothing to tell them which
   * control was at fault.
   */
  it.each([
    form({ mode: "weekly" }),
    form({ mode: "weekly", weekdays: ["MO", "WE", "FR"], interval: 2 }),
    form({ mode: "weekly", endMode: "count", count: 15 }),
    form({ mode: "weekly", endMode: "until", untilDate: "2026-12-31" }),
    form({ mode: "monthly", monthlyMode: "dayOfMonth" }),
    form({ mode: "monthly", monthlyMode: "nthWeekday", interval: 3 }),
  ])("builds a rule the server's parser accepts (%#)", (state) => {
    const rule = buildRrule(state, ANCHOR);
    expect(rule).not.toBeNull();
    expect(() => parseRrule(rule!)).not.toThrow();
  });
});

describe("toUntilStamp", () => {
  /**
   * End-of-day, not midnight: an officer who says "repeats until May
   * 20" means the May 20 meeting happens. Anchoring at midnight drops
   * it, with nothing in the form to explain why.
   */
  it("anchors at the end of the club-local day", () => {
    expect(toUntilStamp("2026-05-20")).toBe("20260521T035959Z");
  });

  it("uses the winter offset in winter", () => {
    expect(toUntilStamp("2026-01-20")).toBe("20260121T045959Z");
  });
});

describe("parseRruleToForm", () => {
  it("treats null as does-not-repeat", () => {
    expect(parseRruleToForm(null)).toEqual(EMPTY_RECURRENCE);
  });

  /**
   * A rule the current subset cannot read still has to open the dialog.
   * Throwing would leave an officer unable to edit the event at all.
   */
  it("falls back to does-not-repeat for an unreadable rule", () => {
    expect(parseRruleToForm("FREQ=HOURLY")).toEqual(EMPTY_RECURRENCE);
  });

  it("reads a weekly rule back", () => {
    const state = parseRruleToForm("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE");
    expect(state.mode).toBe("weekly");
    expect(state.interval).toBe(2);
    expect(state.weekdays).toEqual(["MO", "WE"]);
    expect(state.endMode).toBe("never");
  });

  it("reads a monthly nth-weekday rule back", () => {
    const state = parseRruleToForm("FREQ=MONTHLY;BYDAY=2WE");
    expect(state.mode).toBe("monthly");
    expect(state.monthlyMode).toBe("nthWeekday");
  });

  it("reads a monthly day-of-month rule back", () => {
    expect(parseRruleToForm("FREQ=MONTHLY").monthlyMode).toBe("dayOfMonth");
  });

  it("reads COUNT back", () => {
    const state = parseRruleToForm("FREQ=WEEKLY;COUNT=8");
    expect(state.endMode).toBe("count");
    expect(state.count).toBe(8);
  });

  it("reads UNTIL back as a club-local date", () => {
    const state = parseRruleToForm("FREQ=WEEKLY;UNTIL=20260521T035959Z");
    expect(state.endMode).toBe("until");
    expect(state.untilDate).toBe("2026-05-20");
  });
});

describe("build / parse round trip", () => {
  /**
   * The property that matters most: opening an existing series to fix a
   * typo and saving must not change its schedule.
   */
  it.each([
    form({ mode: "weekly" }),
    form({ mode: "weekly", weekdays: ["TU", "TH"], interval: 2 }),
    form({ mode: "weekly", endMode: "count", count: 12 }),
    form({ mode: "weekly", endMode: "until", untilDate: "2026-05-20" }),
    form({ mode: "monthly", monthlyMode: "dayOfMonth", interval: 2 }),
    form({ mode: "monthly", monthlyMode: "nthWeekday" }),
  ])("survives a round trip unchanged (%#)", (state) => {
    const rule = buildRrule(state, ANCHOR);
    const back = parseRruleToForm(rule);
    expect(buildRrule(back, ANCHOR)).toBe(rule);
  });
});

describe("describeRecurrence", () => {
  it("describes a one-off", () => {
    expect(describeRecurrence(form({ mode: "none" }), ANCHOR)).toBe(
      "Happens once.",
    );
  });

  it("falls back to the anchor's weekday when none is chosen", () => {
    expect(describeRecurrence(form({ mode: "weekly" }), ANCHOR)).toBe(
      "Every week on Wednesday.",
    );
  });

  it("lists chosen weekdays", () => {
    expect(
      describeRecurrence(
        form({ mode: "weekly", weekdays: ["MO", "WE"], interval: 2 }),
        ANCHOR,
      ),
    ).toBe("Every 2 weeks on Monday, Wednesday.");
  });

  it("describes a monthly nth-weekday rule in words", () => {
    expect(
      describeRecurrence(
        form({ mode: "monthly", monthlyMode: "nthWeekday" }),
        ANCHOR,
      ),
    ).toBe("Every month on the second Wednesday.");
  });

  it("describes a monthly day-of-month rule", () => {
    expect(
      describeRecurrence(
        form({ mode: "monthly", monthlyMode: "dayOfMonth" }),
        ANCHOR,
      ),
    ).toBe("Every month on day 13.");
  });

  it("mentions the bound", () => {
    expect(
      describeRecurrence(
        form({ mode: "weekly", endMode: "count", count: 6 }),
        ANCHOR,
      ),
    ).toBe("Every week on Wednesday, 6 times.");
    expect(
      describeRecurrence(
        form({ mode: "weekly", endMode: "until", untilDate: "2026-05-20" }),
        ANCHOR,
      ),
    ).toBe("Every week on Wednesday, until 2026-05-20.");
  });
});
