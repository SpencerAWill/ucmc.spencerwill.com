import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import { CalendarMonthGrid } from "#/features/calendar/components/calendar-month-grid";
import type { CalendarOccurrence } from "#/features/calendar/server/calendar-fns";

function clubLocal(local: string): Temporal.Instant {
  return Temporal.PlainDateTime.from(local)
    .toZonedDateTime(CLUB_TIME_ZONE)
    .toInstant();
}

function occurrence(
  overrides: Partial<CalendarOccurrence> = {},
): CalendarOccurrence {
  const startsAt = clubLocal("2026-05-06T18:00");
  return {
    eventId: "evt_1",
    publicId: "abc123",
    occurrenceStart: startsAt,
    startsAt,
    endsAt: null,
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

const MAY_2026 = Temporal.PlainYearMonth.from("2026-05");

function renderGrid(
  overrides: {
    byDate?: Map<string, CalendarOccurrence[]>;
    onSelect?: (date: Temporal.PlainDate) => void;
    onMonthChange?: (month: Temporal.PlainYearMonth) => void;
  } = {},
) {
  return render(
    <CalendarMonthGrid
      month={MAY_2026}
      onMonthChange={overrides.onMonthChange ?? vi.fn()}
      selected={Temporal.PlainDate.from("2026-05-06")}
      onSelect={overrides.onSelect ?? vi.fn()}
      occurrencesByDate={overrides.byDate ?? new Map()}
    />,
  );
}

/**
 * A day cell by its number.
 *
 * Matched on text rather than accessible name: DayPicker labels each
 * button with a formatted date ("Thursday, May 14th, 2026"), so a
 * name-based query is both locale-dependent and not an exact match for
 * the number. Days 7–25 are unambiguous in a May 2026 grid — the
 * outside days it also renders are Apr 26–30 and Jun 1–6.
 */
function dayButton(day: number): HTMLElement {
  const match = screen
    .getAllByRole("button")
    .find((button) => button.textContent.trim() === String(day));
  if (!match) {
    throw new Error(`No day cell for ${day}`);
  }
  return match;
}

describe("CalendarMonthGrid", () => {
  it("renders the month's days", () => {
    renderGrid();
    expect(dayButton(14)).toBeInTheDocument();
  });

  /**
   * **The regression this file exists for.** An earlier version replaced
   * `CalendarDayButton` with a bare `<button>` carrying only
   * flex-centering classes, dropping the `aspect-square size-auto
   * w-full min-w-(--cell-size)` box that component owns. The grid still
   * looked correct and was almost impossible to click.
   */
  it("calls onSelect when a day is clicked", async () => {
    const onSelect = vi.fn();
    renderGrid({ onSelect });

    await userEvent.click(dayButton(14));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].toString()).toBe("2026-05-14");
  });

  it("still calls onSelect for a day that has events", async () => {
    const onSelect = vi.fn();
    renderGrid({
      onSelect,
      byDate: new Map([["2026-05-14", [occurrence()]]]),
    });

    await userEvent.click(dayButton(14));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("navigates months through the nav buttons", async () => {
    const onMonthChange = vi.fn();
    renderGrid({ onMonthChange });

    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onMonthChange).toHaveBeenCalledTimes(1);
    expect(onMonthChange.mock.calls[0][0].toString()).toBe("2026-06");
  });

  /**
   * Dots are decoration carrying no text, so they must not reach the
   * accessible name — the cell has to announce as its date. The kind is
   * conveyed in the agenda's text beside the same dot colour.
   */
  it("keeps dots out of the cell's text", () => {
    renderGrid({ byDate: new Map([["2026-05-14", [occurrence()]]]) });
    // The dots are `aria-hidden` and carry no text, so the cell still
    // reads as its date. Colour is never the only carrier: the agenda
    // prints the kind's label beside the same colour.
    expect(dayButton(14).textContent.trim()).toBe("14");
  });

  it("does not mark a day that has only cancelled events", () => {
    const { container } = render(
      <CalendarMonthGrid
        month={MAY_2026}
        onMonthChange={vi.fn()}
        selected={Temporal.PlainDate.from("2026-05-06")}
        onSelect={vi.fn()}
        occurrencesByDate={
          new Map([["2026-05-14", [occurrence({ canceled: true })]]])
        }
      />,
    );
    // No dot elements anywhere: the only event that day is cancelled.
    expect(container.querySelectorAll("span.size-1")).toHaveLength(0);
  });

  it("renders one dot per distinct kind, capped at three", () => {
    const { container } = render(
      <CalendarMonthGrid
        month={MAY_2026}
        onMonthChange={vi.fn()}
        selected={Temporal.PlainDate.from("2026-05-06")}
        onSelect={vi.fn()}
        occurrencesByDate={
          new Map([
            [
              "2026-05-14",
              [
                occurrence({ kind: "meeting", publicId: "a" }),
                occurrence({ kind: "meeting", publicId: "b" }),
                occurrence({ kind: "trip", publicId: "c" }),
                occurrence({ kind: "social", publicId: "d" }),
                occurrence({ kind: "exec", publicId: "e" }),
              ],
            ],
          ])
        }
      />,
    );
    expect(container.querySelectorAll("span.size-1")).toHaveLength(3);
  });
});
