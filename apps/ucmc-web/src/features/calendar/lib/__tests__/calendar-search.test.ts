import { describe, expect, it } from "vitest";

import {
  calendarSearchFor,
  calendarSearchSchema,
  kindsFromSearch,
} from "#/features/calendar/lib/calendar-search";

/**
 * `/calendar`'s URL state.
 *
 * The governing rule: **a hand-edited or stale link must still open the
 * calendar.** `validateSearch` throwing would turn a two-year-old link
 * in a GroupMe message into a crash, so every parameter degrades on its
 * own rather than taking the page down with it.
 */
const parse = (input: unknown) => calendarSearchSchema.parse(input);

describe("parsing", () => {
  it("accepts a full view", () => {
    expect(
      parse({
        month: "2026-05",
        from: "2026-05-08",
        to: "2026-05-10",
        kind: "trip,meeting",
      }),
    ).toEqual({
      month: "2026-05",
      from: "2026-05-08",
      to: "2026-05-10",
      kind: "meeting,trip",
    });
  });

  it("accepts an empty search", () => {
    expect(parse({})).toEqual({
      month: undefined,
      from: undefined,
      to: undefined,
      kind: undefined,
    });
  });

  it.each([
    ["2026-13", "month 13"],
    ["2026-00", "month 0"],
    ["26-05", "two-digit year"],
    ["2026-5", "unpadded month"],
    ["May 2026", "prose"],
    ["", "empty"],
  ])("drops a malformed month (%s — %s)", (month) => {
    expect(parse({ month }).month).toBeUndefined();
  });

  it.each([
    ["2026-02-30", "not a real date"],
    ["2026-5-8", "unpadded"],
    ["08/05/2026", "wrong format"],
  ])("drops a malformed from (%s — %s)", (from) => {
    expect(parse({ from }).from).toBeUndefined();
  });

  /** A `to` with no `from` describes nothing. */
  it("drops a to with no from", () => {
    expect(parse({ to: "2026-05-10" }).to).toBeUndefined();
  });

  /** A reversed pair is someone's hand-edit, not an intent. */
  it("drops a reversed range but keeps the month view", () => {
    const result = parse({
      month: "2026-05",
      from: "2026-05-10",
      to: "2026-05-08",
    });
    expect(result.from).toBe("2026-05-10");
    expect(result.to).toBeUndefined();
    expect(result.month).toBe("2026-05");
  });

  it("allows a single-day range where from equals to", () => {
    expect(parse({ from: "2026-05-08", to: "2026-05-08" }).to).toBe(
      "2026-05-08",
    );
  });

  it("ignores unknown kinds rather than rejecting the link", () => {
    expect(parse({ kind: "trip,potluck,meeting" }).kind).toBe("meeting,trip");
  });

  it("drops the filter when no kind survives", () => {
    expect(parse({ kind: "potluck" }).kind).toBeUndefined();
  });

  it("normalizes case, whitespace and duplicates, and sorts", () => {
    expect(parse({ kind: " TRIP , trip,Meeting " }).kind).toBe("meeting,trip");
  });

  /**
   * The router hands a repeated parameter over as an array, and someone
   * editing a URL by hand may well write one.
   */
  it("accepts a repeated parameter as an array", () => {
    expect(parse({ kind: ["trip", "meeting"] }).kind).toBe("meeting,trip");
  });

  it("ignores a kind that is neither string nor array", () => {
    expect(parse({ kind: 7 }).kind).toBeUndefined();
    expect(parse({ kind: {} }).kind).toBeUndefined();
  });

  it("never throws on junk", () => {
    expect(() =>
      parse({ month: 7, from: true, to: {}, kind: null, stray: "x" }),
    ).not.toThrow();
  });
});

describe("calendarSearchFor", () => {
  const CURRENT = Temporal.PlainYearMonth.from("2026-05");

  /**
   * The current month is left out, so `/calendar` stays the canonical
   * "what's on now" link rather than every visit rewriting it to a
   * dated one that ages badly the moment it is shared.
   */
  it("omits the current month", () => {
    expect(
      calendarSearchFor({ month: CURRENT, currentMonth: CURRENT, kinds: [] }),
    ).toEqual({
      month: undefined,
      from: undefined,
      to: undefined,
      kind: undefined,
    });
  });

  it("includes any other month", () => {
    expect(
      calendarSearchFor({
        month: Temporal.PlainYearMonth.from("2026-06"),
        currentMonth: CURRENT,
        kinds: [],
      }).month,
    ).toBe("2026-06");
  });

  it("emits a half-open range as from only", () => {
    expect(
      calendarSearchFor({
        month: CURRENT,
        currentMonth: CURRENT,
        range: { from: Temporal.PlainDate.from("2026-05-08"), to: null },
        kinds: [],
      }),
    ).toMatchObject({ from: "2026-05-08", to: undefined });
  });

  it("emits a full range", () => {
    expect(
      calendarSearchFor({
        month: CURRENT,
        currentMonth: CURRENT,
        range: {
          from: Temporal.PlainDate.from("2026-05-08"),
          to: Temporal.PlainDate.from("2026-05-10"),
        },
        kinds: [],
      }),
    ).toMatchObject({ from: "2026-05-08", to: "2026-05-10" });
  });

  /**
   * Sorted, so the same selection always produces the same link rather
   * than one per click order — which would make two readers who picked
   * the same filters unable to tell they were looking at the same view.
   */
  it("sorts kinds so the link is stable", () => {
    expect(
      calendarSearchFor({
        month: CURRENT,
        currentMonth: CURRENT,
        kinds: ["trip", "meeting"],
      }).kind,
    ).toBe(
      calendarSearchFor({
        month: CURRENT,
        currentMonth: CURRENT,
        kinds: ["meeting", "trip"],
      }).kind,
    );
  });

  it("omits an empty filter", () => {
    expect(
      calendarSearchFor({ month: CURRENT, currentMonth: CURRENT, kinds: [] })
        .kind,
    ).toBeUndefined();
  });

  /**
   * **Everything it emits must survive its own parser, VERBATIM.**
   *
   * The first version of this test reshaped `kind` with `.join(",")`
   * before re-parsing — and so passed while the real round trip was
   * broken: `calendarSearchFor` emitted an array, the router
   * JSON-encoded it, and the parser rejected it as "not a string" and
   * dropped the filter. Every filter click navigated to a URL that
   * silently lost the filter. A round-trip test that reshapes its input
   * is testing around the defect it exists to catch.
   */
  it("round-trips through the schema verbatim", () => {
    const search = calendarSearchFor({
      month: Temporal.PlainYearMonth.from("2026-11"),
      currentMonth: CURRENT,
      range: {
        from: Temporal.PlainDate.from("2026-11-06"),
        to: Temporal.PlainDate.from("2026-11-08"),
      },
      kinds: ["trip", "exec"],
    });
    expect(parse(search)).toEqual(search);
  });

  it("emits kind as the same comma string the parser reads", () => {
    expect(
      calendarSearchFor({
        month: CURRENT,
        currentMonth: CURRENT,
        kinds: ["trip", "meeting"],
      }).kind,
    ).toBe("meeting,trip");
  });
});

describe("kindsFromSearch", () => {
  it("splits the parsed parameter into a list", () => {
    expect(kindsFromSearch("meeting,trip")).toEqual(["meeting", "trip"]);
  });

  it("answers an empty list for no filter", () => {
    expect(kindsFromSearch(undefined)).toEqual([]);
    expect(kindsFromSearch("")).toEqual([]);
  });

  it("drops anything the vocabulary no longer contains", () => {
    expect(kindsFromSearch("meeting,potluck")).toEqual(["meeting"]);
  });

  /** The pair that has to agree: what is written, read back as a list. */
  it("round-trips what calendarSearchFor emits", () => {
    const search = calendarSearchFor({
      month: Temporal.PlainYearMonth.from("2026-05"),
      currentMonth: Temporal.PlainYearMonth.from("2026-05"),
      kinds: ["trip", "exec", "meeting"],
    });
    expect(kindsFromSearch(parse(search).kind)).toEqual([
      "exec",
      "meeting",
      "trip",
    ]);
  });
});
