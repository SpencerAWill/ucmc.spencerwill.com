import { useMemo } from "react";

import { Calendar, CalendarDayButton } from "#/components/ui/calendar";
import type { EventKind } from "#/../drizzle/schema";
import type { CalendarOccurrence } from "#/features/calendar/server/calendar-fns";
import {
  clubToday,
  fromPickerDate,
  toPickerDate,
} from "#/features/calendar/lib/calendar-window";
import { EVENT_KIND_DOT } from "#/features/calendar/lib/event-display";
import { cn } from "#/lib/utils";

/**
 * Month grid with a dot per kind on days that have something on.
 *
 * **Dots, not event chips.** This is the Apple Calendar / Luma shape
 * rather than the Google-desktop one, and it is deliberate for a
 * surface that has to work at 400px: chips inside a 40px cell are
 * unreadable on a phone and need a dedicated calendar library to lay
 * out, while dots degrade to "something is happening here, tap to see"
 * — the question a month grid is actually good at answering. The agenda
 * beside it carries the detail. It also means `react-day-picker` —
 * already a dependency — is sufficient.
 *
 * **The day cell wraps `CalendarDayButton`; it does not replace it.**
 * That component owns the cell's entire box — `aspect-square`,
 * `size-auto`, `w-full`, `min-w-(--cell-size)` — plus the selected,
 * range and focus states. An earlier version rendered a bare `<button>`
 * with only flex-centering classes, which collapsed every cell to
 * roughly the size of its text and left the grid looking right while
 * being almost impossible to click.
 */
export function CalendarMonthGrid({
  month,
  onMonthChange,
  selected,
  onSelect,
  occurrencesByDate,
  className,
}: {
  month: Temporal.PlainYearMonth;
  onMonthChange: (month: Temporal.PlainYearMonth) => void;
  selected: Temporal.PlainDate;
  onSelect: (date: Temporal.PlainDate) => void;
  occurrencesByDate: ReadonlyMap<string, CalendarOccurrence[]>;
  className?: string;
}) {
  // One entry per day that has anything on it, so a cell can render its
  // dots without re-scanning the occurrence list.
  const kindsByDate = useMemo(() => {
    const out = new Map<string, EventKind[]>();
    for (const [date, occurrences] of occurrencesByDate) {
      const kinds = [
        ...new Set(occurrences.filter((o) => !o.canceled).map((o) => o.kind)),
      ];
      if (kinds.length > 0) {
        // Capped at three: more would widen the row of dots past the
        // cell and break the grid's column alignment.
        out.set(date, kinds.slice(0, 3));
      }
    }
    return out;
  }, [occurrencesByDate]);

  return (
    <Calendar
      className={cn("w-full bg-transparent p-0", className)}
      mode="single"
      month={toPickerDate(month.toPlainDate({ day: 1 }))}
      onMonthChange={(next) => {
        const plain = fromPickerDate(next);
        onMonthChange(
          Temporal.PlainYearMonth.from({
            year: plain.year,
            month: plain.month,
          }),
        );
      }}
      selected={toPickerDate(selected)}
      onSelect={(next) => {
        if (next) {
          onSelect(fromPickerDate(next));
        }
      }}
      showOutsideDays
      /**
       * **`today` must be passed explicitly or the page fails to
       * hydrate.** DayPicker otherwise derives it from `new Date()` in
       * the *runtime's* zone — and the worker runs UTC while the browser
       * runs the viewer's. Any evening after 20:00 EDT, UTC is already
       * tomorrow, so the server stamps the `today` modifier on one cell
       * and the client on another: "some attributes of the server
       * rendered HTML didn't match the client properties".
       *
       * Passing the club's today is also the correct value — this is the
       * club's calendar, so the ringed cell should be the club's today
       * for every viewer, not each viewer's own.
       */
      today={toPickerDate(clubToday())}
      components={{
        DayButton: ({ children, ...props }) => {
          const kinds = kindsByDate.get(
            fromPickerDate(props.day.date).toString(),
          );
          return (
            <CalendarDayButton {...props}>
              {children}
              {kinds ? (
                /*
                 * Absolutely positioned so the dots never enter the
                 * cell's content box — a day with events has to line up
                 * with a day without one. `pointer-events-none` keeps
                 * the whole cell a single click target.
                 *
                 * `opacity-100` overrides the `[&>span]:opacity-70` the
                 * shadcn day button applies to secondary text, which
                 * would otherwise wash the dots out.
                 */
                <span
                  className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center gap-0.5 opacity-100"
                  aria-hidden
                >
                  {kinds.map((kind) => (
                    <span
                      key={kind}
                      className={cn(
                        "size-1 rounded-full",
                        EVENT_KIND_DOT[kind],
                      )}
                    />
                  ))}
                </span>
              ) : null}
            </CalendarDayButton>
          );
        },
      }}
    />
  );
}
