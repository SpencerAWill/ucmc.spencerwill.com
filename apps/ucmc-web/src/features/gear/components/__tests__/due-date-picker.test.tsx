import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DueDatePicker } from "#/features/gear/components/due-date-picker";

/**
 * The picker is anchored to *today* in the runtime-local zone, so the
 * clock has to be pinned or the weekday under test moves with the
 * calendar. 2026-10-05 is a Monday.
 */
const MONDAY = new Date(2026, 9, 5, 9, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MONDAY);
});

afterEach(() => {
  vi.useRealTimers();
});

const HINT = /cave shut that day/i;

describe("DueDatePicker cave-hours hint", () => {
  it("warns when the due date lands on a day the cave is shut", () => {
    // Monday + 7 is a Monday. The officer's pick is NOT rewritten — the
    // whole point of the hint is that the control and the submitted
    // value still agree about what was agreed with the member.
    render(
      <DueDatePicker
        id="due"
        durationDays={7}
        onDurationChange={vi.fn()}
        caveOpenWeekdays={[3]}
      />,
    );

    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(screen.getByLabelText("Due")).toHaveValue("2026-10-12");
  });

  it("names every open day, so the hint says what to do instead", () => {
    // Tuesday + 7 is a Tuesday, shut under both. A hint that only says
    // "shut" leaves the officer to guess which day to pick.
    vi.setSystemTime(new Date(2026, 9, 6, 9, 0, 0));
    render(
      <DueDatePicker
        id="due"
        durationDays={7}
        onDurationChange={vi.fn()}
        caveOpenWeekdays={[1, 3]}
      />,
    );

    expect(screen.getByText(/open Mon, Wed/)).toBeInTheDocument();
  });

  it("stays quiet when a wider open set covers the due date", () => {
    // Monday + 7 is a Monday: the exact input that warns when only
    // Wednesday is open must fall silent once Monday is open too.
    render(
      <DueDatePicker
        id="due"
        durationDays={7}
        onDurationChange={vi.fn()}
        caveOpenWeekdays={[1, 3]}
      />,
    );

    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it("stays quiet when the due date is an open day", () => {
    // Monday + 2 is Wednesday.
    render(
      <DueDatePicker
        id="due"
        durationDays={2}
        onDurationChange={vi.fn()}
        caveOpenWeekdays={[3]}
      />,
    );

    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it("stays quiet for a same-day loan", () => {
    // The exec-meeting case: handed back in the room, not at the cave,
    // so the cave's hours say nothing about it. Monday is a shut day, so
    // a naive weekday check would warn here.
    render(
      <DueDatePicker
        id="due"
        durationDays={0}
        onDurationChange={vi.fn()}
        caveOpenWeekdays={[3]}
      />,
    );

    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it("stays quiet when no open days are configured", () => {
    // The summer, and also every caller that hasn't opted in — the prop
    // defaults to empty, so an existing call site can't start warning.
    render(
      <DueDatePicker id="due" durationDays={7} onDurationChange={vi.fn()} />,
    );

    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it("warns on a Sunday due date when the cave opens Wednesdays", () => {
    // Monday + 6 is Sunday. Sunday is the one weekday where ISO (7) and
    // `Date.getDay()` (0) disagree, so a mixed-convention bug shows up
    // here and nowhere else.
    render(
      <DueDatePicker
        id="due"
        durationDays={6}
        onDurationChange={vi.fn()}
        caveOpenWeekdays={[3]}
      />,
    );

    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it("stays quiet on a Sunday due date when the cave opens Sundays", () => {
    // The other half of the same conversion: ISO 7 must match a Sunday.
    render(
      <DueDatePicker
        id="due"
        durationDays={6}
        onDurationChange={vi.fn()}
        caveOpenWeekdays={[7]}
      />,
    );

    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });
});
