import { describe, expect, it } from "vitest";

import {
  formatWeekdayList,
  isoWeekdayFromDate,
  parseWeekdayList,
  WEEKDAY_NAMES,
} from "#/lib/weekdays";

describe("parseWeekdayList", () => {
  it("parses the single-day case the cave actually runs on", () => {
    expect(parseWeekdayList("Wed")).toEqual([3]);
  });

  it("accepts full names and plurals, which is what people type", () => {
    // `gear.caveOpenDays` is a free-text settings row. Somebody writing
    // out the cave's hours writes "Wednesdays", not an abbreviation.
    expect(parseWeekdayList("Wednesday")).toEqual([3]);
    expect(parseWeekdayList("Wednesdays")).toEqual([3]);
  });

  it("is case- and whitespace-insensitive across a list", () => {
    expect(parseWeekdayList("  mon , WED  ")).toEqual([1, 3]);
  });

  it("sorts and de-duplicates so storage order can't change meaning", () => {
    expect(parseWeekdayList("Fri,Mon,Fri")).toEqual([1, 5]);
  });

  it("treats blank as no open days rather than as an error", () => {
    // The summer: `gear.caveHoursNote` goes blank beside it and the desk
    // falls back to the plain loan length. That's a configuration, not a
    // typo, so it must not be rejected by the registry's refinement.
    expect(parseWeekdayList("")).toEqual([]);
    expect(parseWeekdayList("   ")).toEqual([]);
  });

  it("rejects a token that isn't a weekday", () => {
    expect(parseWeekdayList("Wensday")).toBeNull();
    expect(parseWeekdayList("Wed,Funday")).toBeNull();
  });

  it("rejects a single ambiguous letter instead of guessing", () => {
    // `S` is Sat or Sun, and a bare findIndex would silently pick Sat.
    expect(parseWeekdayList("S")).toBeNull();
    expect(parseWeekdayList("M")).toBeNull();
  });

  it("numbers Sunday 7, not 0", () => {
    // ISO numbering, matching `Temporal.PlainDate.prototype.dayOfWeek`.
    // Sunday is the ONLY day where ISO and `Date.getDay()` disagree, so
    // it is the only day that catches a mixed-convention bug.
    expect(parseWeekdayList("Sun")).toEqual([7]);
    expect(parseWeekdayList("Mon")).toEqual([1]);
  });

  it("round-trips through formatWeekdayList", () => {
    expect(formatWeekdayList(parseWeekdayList("Wed,Mon") ?? [])).toBe(
      "Mon,Wed",
    );
  });

  it("parses every name it formats", () => {
    for (const name of WEEKDAY_NAMES) {
      expect(parseWeekdayList(name)).not.toBeNull();
    }
  });
});

describe("isoWeekdayFromDate", () => {
  it("maps a JS Date's Sunday-0 onto ISO Sunday-7", () => {
    // 2026-10-11 is a Sunday; `getDay()` returns 0.
    expect(isoWeekdayFromDate(new Date(2026, 9, 11))).toBe(7);
  });

  it("agrees with Temporal for every day of a week", () => {
    // The two numberings agree Mon–Sat and differ only on Sunday, so
    // pinning a whole week is what makes the conversion meaningful.
    for (let day = 5; day <= 11; day += 1) {
      const date = new Date(2026, 9, day);
      const plain = Temporal.PlainDate.from({ year: 2026, month: 10, day });
      expect(isoWeekdayFromDate(date)).toBe(plain.dayOfWeek);
    }
  });
});
