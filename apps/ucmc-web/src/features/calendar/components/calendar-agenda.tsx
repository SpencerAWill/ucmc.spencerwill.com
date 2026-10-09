import { CalendarOff, MapPin, Repeat } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import type { CalendarOccurrence } from "#/features/calendar/server/calendar-fns";
import {
  EVENT_KIND_DOT,
  EVENT_KIND_LABEL,
  EVENT_VISIBILITY_LABEL,
  formatClubDayHeading,
  formatClubTimeRange,
} from "#/features/calendar/lib/event-display";
import { cn } from "#/lib/utils";

/**
 * The agenda beside (desktop) or below (phone) the month grid.
 *
 * **Stacked rows, not a table.** Per the responsive-collections rule
 * this surface serves "find the one I care about and act on it", not
 * "compare a value down the list" — nobody scans a column of start
 * times looking for an outlier. So it is a `<ul>` of real list items
 * rather than a table with `display: block` applied at narrow widths,
 * which would look the same and silently destroy the row semantics for
 * assistive tech.
 */
export function CalendarAgenda({
  days,
  onSelect,
  emptyLabel,
}: {
  days: readonly {
    date: Temporal.PlainDate;
    occurrences: readonly CalendarOccurrence[];
  }[];
  onSelect?: (occurrence: CalendarOccurrence) => void;
  emptyLabel: string;
}) {
  if (days.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {days.map(({ date, occurrences }) => (
        <section key={date.toString()} className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            {formatClubDayHeading(date)}
          </h3>
          <ul className="space-y-2">
            {occurrences.map((occurrence) => (
              <li
                key={`${occurrence.publicId}:${occurrence.occurrenceStart.epochMilliseconds}`}
              >
                <AgendaRow occurrence={occurrence} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AgendaRow({
  occurrence,
  onSelect,
}: {
  occurrence: CalendarOccurrence;
  onSelect?: (occurrence: CalendarOccurrence) => void;
}) {
  const body = (
    <>
      <span
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          EVENT_KIND_DOT[occurrence.kind],
          occurrence.canceled && "opacity-40",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              "font-medium",
              occurrence.canceled && "text-muted-foreground line-through",
            )}
          >
            {occurrence.title}
          </span>
          {occurrence.canceled ? (
            <Badge variant="destructive">
              <CalendarOff />
              Cancelled
            </Badge>
          ) : null}
          {/* Officer-only events are badged wherever they appear. An
           * officer scanning a shared screen at a meeting needs to know
           * at a glance that a row isn't something the room can see. */}
          {occurrence.visibility === "officers" ? (
            <Badge variant="warning">{EVENT_VISIBILITY_LABEL.officers}</Badge>
          ) : null}
        </span>
        {/* Secondary fields demoted to one meta line, so a narrow row
         * stays two lines tall whatever it carries. */}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
          <span>
            {formatClubTimeRange(
              occurrence.startsAt,
              occurrence.endsAt,
              occurrence.allDay,
            )}
          </span>
          <span aria-hidden>·</span>
          <span>{EVENT_KIND_LABEL[occurrence.kind]}</span>
          {occurrence.location ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {occurrence.location}
              </span>
            </>
          ) : null}
          {occurrence.isRecurring ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Repeat className="size-3.5" aria-hidden />
                Repeats
              </span>
            </>
          ) : null}
        </span>
      </span>
    </>
  );

  if (!onSelect) {
    return <div className="flex gap-3 rounded-lg border p-3">{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(occurrence)}
      className="flex w-full gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {body}
    </button>
  );
}
