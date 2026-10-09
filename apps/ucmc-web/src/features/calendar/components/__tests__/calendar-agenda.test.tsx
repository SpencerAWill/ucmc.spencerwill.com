import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import { CalendarAgenda } from "#/features/calendar/components/calendar-agenda";
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
    eventId: "id-1",
    publicId: "evt1",
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
    canceled: false,
    sequence: 0,
    updatedAt: startsAt,
    ...overrides,
  };
}

const MAY_6 = Temporal.PlainDate.from("2026-05-06");

function renderAgenda(
  occurrences: CalendarOccurrence[],
  onSelect?: (o: CalendarOccurrence) => void,
) {
  return render(
    <CalendarAgenda
      days={[{ date: MAY_6, occurrences }]}
      onSelect={onSelect}
      emptyLabel="Nothing this month."
    />,
  );
}

describe("CalendarAgenda", () => {
  it("renders the day heading and the event", () => {
    renderAgenda([occurrence()]);
    expect(screen.getByText("Wednesday, May 6")).toBeInTheDocument();
    expect(screen.getByText("Weekly meeting")).toBeInTheDocument();
  });

  /**
   * Times render in the CLUB's zone, not the viewer's. A member in
   * Denver needs the time the club is meeting; `formatDateTime` from
   * `#/lib/date-format` would render 4:00 PM for them and put the row
   * under a heading that says Wednesday.
   */
  it("renders the start and end in club time", () => {
    renderAgenda([occurrence()]);
    expect(screen.getByText("6:00 PM – 7:00 PM")).toBeInTheDocument();
  });

  it("renders just the start when there is no end", () => {
    renderAgenda([occurrence({ endsAt: null })]);
    expect(screen.getByText("6:00 PM")).toBeInTheDocument();
  });

  it("renders an all-day event without a time", () => {
    renderAgenda([occurrence({ allDay: true })]);
    expect(screen.getByText("All day")).toBeInTheDocument();
  });

  it("shows the location when there is one", () => {
    renderAgenda([occurrence({ location: "Campus Rec" })]);
    expect(screen.getByText("Campus Rec")).toBeInTheDocument();
  });

  it("marks a recurring occurrence", () => {
    renderAgenda([occurrence({ rrule: "FREQ=WEEKLY;BYDAY=WE" })]);
    expect(screen.getByText("Repeats")).toBeInTheDocument();
  });

  it("marks a cancelled occurrence rather than hiding it", () => {
    renderAgenda([occurrence({ canceled: true })]);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Weekly meeting")).toBeInTheDocument();
  });

  /**
   * An officer scanning a shared screen at a meeting needs to know at a
   * glance that a row is not something the room can see.
   */
  it("badges an officers-only event", () => {
    renderAgenda([occurrence({ visibility: "officers" })]);
    expect(screen.getByText("Officers only")).toBeInTheDocument();
  });

  it("does not badge a members-visible event", () => {
    renderAgenda([occurrence({ visibility: "members" })]);
    expect(screen.queryByText("Officers only")).not.toBeInTheDocument();
  });

  it("renders the kind label beside the dot", () => {
    renderAgenda([occurrence({ kind: "trip" })]);
    expect(screen.getByText("Trip")).toBeInTheDocument();
  });

  it("shows the empty label when there is nothing on", () => {
    render(<CalendarAgenda days={[]} emptyLabel="Nothing this month." />);
    expect(screen.getByText("Nothing this month.")).toBeInTheDocument();
  });

  it("calls onSelect with the occurrence when a row is activated", async () => {
    const onSelect = vi.fn();
    const row = occurrence();
    renderAgenda([row], onSelect);

    await userEvent.click(
      screen.getByRole("button", { name: /Weekly meeting/ }),
    );
    expect(onSelect).toHaveBeenCalledWith(row);
  });

  /**
   * Without `onSelect` the rows must not be buttons: a non-interactive
   * control announced as a button is worse than a plain row.
   */
  it("renders inert rows when there is nothing to select into", () => {
    renderAgenda([occurrence()]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  /**
   * Stacked list items, not a table with `display: block` — the latter
   * looks identical and silently strips the row semantics assistive
   * tech relies on.
   */
  it("renders occurrences as list items", () => {
    renderAgenda([
      occurrence(),
      occurrence({ publicId: "evt2", title: "Social" }),
    ]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
