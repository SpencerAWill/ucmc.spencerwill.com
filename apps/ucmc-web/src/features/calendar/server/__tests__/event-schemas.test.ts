import { describe, expect, it } from "vitest";

import {
  CALENDAR_WINDOW_MAX_DAYS,
  calendarWindowInputSchema,
  cancelEventInputSchema,
  clearOccurrenceOverrideInputSchema,
  createEventInputSchema,
  deleteEventInputSchema,
  overrideOccurrenceInputSchema,
  updateEventInputSchema,
} from "#/features/calendar/server/event-schemas";
import type {
  CalendarWindowInput,
  CancelEventInput,
  ClearOccurrenceOverrideInput,
  CreateEventInput,
  DeleteEventInput,
  OverrideOccurrenceInput,
  UpdateEventInput,
} from "#/features/calendar/server/event-schemas";

/**
 * The validator boundary.
 *
 * These schemas are the only thing standing between officer-typed text
 * and the expander, so the RRULE cases matter most: a rule that passes
 * the form but not the expander would let an officer save a series that
 * then throws on every render of the page.
 */

const MAY_6 = Date.UTC(2026, 4, 6, 22, 0, 0);
const MAY_6_LATER = Date.UTC(2026, 4, 6, 23, 0, 0);

function baseEvent(
  overrides: Partial<CreateEventInput> = {},
): CreateEventInput {
  return {
    title: "Weekly meeting",
    startsAt: MAY_6,
    kind: "meeting",
    ...overrides,
  };
}

describe("createEventInputSchema", () => {
  it("fills defaults for everything optional", () => {
    const parsed = createEventInputSchema.parse(baseEvent());
    expect(parsed.description).toBeNull();
    expect(parsed.location).toBeNull();
    expect(parsed.endsAt).toBeNull();
    expect(parsed.allDay).toBe(false);
    expect(parsed.visibility).toBe("members");
    expect(parsed.rrule).toBeNull();
  });

  it("converts epoch milliseconds to a Temporal.Instant", () => {
    const parsed = createEventInputSchema.parse(baseEvent());
    expect(parsed.startsAt).toBeInstanceOf(Temporal.Instant);
    expect(parsed.startsAt.epochMilliseconds).toBe(MAY_6);
  });

  it("trims the title and rejects an empty one", () => {
    expect(
      createEventInputSchema.parse(baseEvent({ title: "  Hi  " })).title,
    ).toBe("Hi");
    expect(
      createEventInputSchema.safeParse(baseEvent({ title: "   " })).success,
    ).toBe(false);
  });

  it("rejects a title past the cap", () => {
    expect(
      createEventInputSchema.safeParse(baseEvent({ title: "x".repeat(121) }))
        .success,
    ).toBe(false);
  });

  it("rejects an end before the start", () => {
    const result = createEventInputSchema.safeParse(
      baseEvent({ startsAt: MAY_6_LATER, endsAt: MAY_6 }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["endsAt"]);
  });

  /**
   * Zero-length is allowed on purpose: it is a reasonable way to say
   * "this happens at 19:00" for an officer who would rather set an
   * explicit end than leave it null.
   */
  it("allows an end equal to the start", () => {
    expect(
      createEventInputSchema.safeParse(baseEvent({ endsAt: MAY_6 })).success,
    ).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(
      createEventInputSchema.safeParse({ ...baseEvent(), kind: "potluck" })
        .success,
    ).toBe(false);
  });
});

describe("createEventInputSchema — recurrence", () => {
  /**
   * Normalizing on write is what lets the feed emit the stored string
   * verbatim: the page and the client are then reading the same bytes.
   */
  it("normalizes a valid rule", () => {
    const parsed = createEventInputSchema.parse(
      baseEvent({ rrule: "rrule:byday=we;freq=weekly;interval=1" }),
    );
    expect(parsed.rrule).toBe("FREQ=WEEKLY;BYDAY=WE");
  });

  /**
   * One definition of "a rule we support", shared with the expander —
   * so a rule that clears the form is always a rule the page can
   * render. A second regex here would be free to disagree.
   */
  it("rejects a rule the expander could not expand", () => {
    const result = createEventInputSchema.safeParse(
      baseEvent({ rrule: "FREQ=DAILY" }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/FREQ must be/);
  });

  it("surfaces the expander's own message for an unsupported component", () => {
    const result = createEventInputSchema.safeParse(
      baseEvent({ rrule: "FREQ=WEEKLY;BYSETPOS=1" }),
    );
    expect(result.error?.issues[0].message).toMatch(
      /BYSETPOS is not supported/,
    );
  });

  it("keeps null for a non-recurring event", () => {
    expect(
      createEventInputSchema.parse(baseEvent({ rrule: null })).rrule,
    ).toBeNull();
  });
});

describe("updateEventInputSchema", () => {
  it("requires a publicId", () => {
    const input: UpdateEventInput = { ...baseEvent(), publicId: "abc123" };
    expect(updateEventInputSchema.parse(input).publicId).toBe("abc123");
    expect(updateEventInputSchema.safeParse(baseEvent()).success).toBe(false);
  });

  it("carries the same end-after-start rule", () => {
    expect(
      updateEventInputSchema.safeParse({
        ...baseEvent({ startsAt: MAY_6_LATER, endsAt: MAY_6 }),
        publicId: "abc123",
      }).success,
    ).toBe(false);
  });
});

describe("cancel / delete schemas", () => {
  it("defaults cancel to true", () => {
    const input: CancelEventInput = { publicId: "abc123" };
    expect(cancelEventInputSchema.parse(input).canceled).toBe(true);
  });

  it("accepts an explicit un-cancel", () => {
    expect(
      cancelEventInputSchema.parse({ publicId: "abc123", canceled: false })
        .canceled,
    ).toBe(false);
  });

  it("requires a publicId to delete", () => {
    const input: DeleteEventInput = { publicId: "abc123" };
    expect(deleteEventInputSchema.parse(input).publicId).toBe("abc123");
    expect(deleteEventInputSchema.safeParse({ publicId: "" }).success).toBe(
      false,
    );
  });
});

describe("occurrence override schemas", () => {
  it("defaults every override field to inherit-from-series", () => {
    const input: OverrideOccurrenceInput = {
      publicId: "abc123",
      occurrenceStart: MAY_6,
    };
    const parsed = overrideOccurrenceInputSchema.parse(input);
    expect(parsed.canceled).toBe(false);
    expect(parsed.title).toBeNull();
    expect(parsed.startsAt).toBeNull();
    expect(parsed.endsAt).toBeNull();
  });

  it("parses occurrenceStart as an instant", () => {
    const parsed = overrideOccurrenceInputSchema.parse({
      publicId: "abc123",
      occurrenceStart: MAY_6,
    });
    expect(parsed.occurrenceStart.epochMilliseconds).toBe(MAY_6);
  });

  it("requires the slot to clear an override", () => {
    const input: ClearOccurrenceOverrideInput = {
      publicId: "abc123",
      occurrenceStart: MAY_6,
    };
    expect(
      clearOccurrenceOverrideInputSchema.parse(input).occurrenceStart
        .epochMilliseconds,
    ).toBe(MAY_6);
    expect(
      clearOccurrenceOverrideInputSchema.safeParse({ publicId: "abc123" })
        .success,
    ).toBe(false);
  });
});

describe("calendarWindowInputSchema", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("accepts a month-sized window", () => {
    const input: CalendarWindowInput = { from: MAY_6, until: MAY_6 + 31 * DAY };
    expect(calendarWindowInputSchema.safeParse(input).success).toBe(true);
  });

  it("rejects a reversed window", () => {
    expect(
      calendarWindowInputSchema.safeParse({ from: MAY_6, until: MAY_6 - DAY })
        .success,
    ).toBe(false);
  });

  it("rejects a zero-width window", () => {
    expect(
      calendarWindowInputSchema.safeParse({ from: MAY_6, until: MAY_6 })
        .success,
    ).toBe(false);
  });

  /**
   * Not a product limit — it is what stops a crafted query asking the
   * expander for ten thousand years of a weekly series.
   */
  it("rejects a window past the cap", () => {
    expect(
      calendarWindowInputSchema.safeParse({
        from: MAY_6,
        until: MAY_6 + (CALENDAR_WINDOW_MAX_DAYS + 1) * DAY,
      }).success,
    ).toBe(false);
  });

  it("accepts an optional kind filter", () => {
    const parsed = calendarWindowInputSchema.parse({
      from: MAY_6,
      until: MAY_6 + DAY,
      kinds: ["trip", "meeting"],
    });
    expect(parsed.kinds).toEqual(["trip", "meeting"]);
  });

  it("rejects an unknown kind in the filter", () => {
    expect(
      calendarWindowInputSchema.safeParse({
        from: MAY_6,
        until: MAY_6 + DAY,
        kinds: ["potluck"],
      }).success,
    ).toBe(false);
  });
});
