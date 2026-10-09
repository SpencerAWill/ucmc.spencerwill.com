import { useMemo } from "react";

import { Calendar } from "#/components/ui/calendar";
import type { CalendarOccurrence } from "#/features/calendar/server/calendar-fns";
import {
  fromPickerDate,
  toPickerDate,
} from "#/features/calendar/lib/calendar-window";
import { EVENT_KIND_DOT } from "#/features/calendar/lib/event-display";
import { cn } from "#/lib/utils";

/**
 * Month grid with a dot per kind on days that have something on.
 *
 * **Dots, not event chips.** This is the Apple Calendar / Luma shape
 * rather than the Google-desktop one, and it is a deliberate choice for
 * a surface that has to work at 400px: chips inside a 40px cell are
 * unreadable on a phone and need a dedicated calendar library to lay
 * out, while dots degrade to "something is happening here, tap to see"
 * — which is the question a month grid is actually good at answering.
 * The agenda beside it carries the detail.
 *
 * It also means `react-day-picker` — already a dependency — is
 * sufficient, and no calendar library enters the bundle.
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
  // One entry per day that has anything on it, so the day cell can
  // render its dots without re-scanning the occurrence list per cell.
  const kindsByDate = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const [date, occurrences] of occurrencesByDate) {
      const kinds = [
        ...new Set(occurrences.filter((o) => !o.canceled).map((o) => o.kind)),
      ];
      if (kinds.length > 0) {
        // Cap at three: a day with five kinds would otherwise widen the
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
      components={{
        DayButton: ({ day, modifiers, className: dayClassName, ...props }) => {
          const key = fromPickerDate(day.date).toString();
          const kinds = kindsByDate.get(key) ?? [];
          return (
            <button
              {...props}
              className={cn(
                "relative flex flex-col items-center justify-center",
                dayClassName,
              )}
              data-selected-single={
                modifiers.selected && !modifiers.range_start ? true : undefined
              }
            >
              <span>{day.date.getDate()}</span>
              {/* Absolutely positioned so the dots never change the
               * cell's content box — a day with events has to line up
               * with a day without one. */}
              <span
                className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center gap-0.5"
                aria-hidden
              >
                {kinds.map((kind) => (
                  <span
                    key={kind}
                    className={cn(
                      "size-1 rounded-full",
                      EVENT_KIND_DOT[kind as keyof typeof EVENT_KIND_DOT],
                    )}
                  />
                ))}
              </span>
            </button>
          );
        },
      }}
    />
  );
}
