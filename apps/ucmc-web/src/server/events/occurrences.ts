/**
 * Series + exceptions + recurrence → the flat list of occurrences the
 * calendar page and both `.ics` feeds render (issue #187).
 *
 * This is the one place the three pieces meet, deliberately. The page
 * and the feed must agree about what happens on a given Wednesday —
 * a member comparing their phone against the website is the whole
 * point of shipping both — so they consume the same function rather
 * than each applying exceptions in their own way.
 *
 * Lives beside the repo in `src/server/` for the same reason the repo
 * does: `events` is a base table that `features/trips` and later
 * `features/volunteer` will read too, and features may not import one
 * another.
 */
import type {
  EventExceptionRow,
  EventSeries,
} from "#/server/events/events-repo.server";
import { expandOccurrences } from "#/server/events/recurrence";

export interface CalendarOccurrence {
  readonly eventId: string;
  readonly publicId: string;
  /**
   * The occurrence's *original* start, as the series generates it —
   * iCalendar's `RECURRENCE-ID`. Identity, not display: it is what an
   * `event_exceptions` row points at, and it stays put when an
   * exception moves the occurrence to a different time.
   */
  readonly occurrenceStart: Temporal.Instant;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant | null;
  readonly allDay: boolean;
  readonly title: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly kind: EventSeries["kind"];
  readonly visibility: EventSeries["visibility"];
  /** True when this came from a recurring series, for the UI's badge. */
  readonly isRecurring: boolean;
  /**
   * Cancelled either because the whole series was called off, or
   * because this one slot was. Kept in the list rather than filtered
   * out: the page drops them, but the feed has to *publish* them as
   * `STATUS:CANCELLED` or subscribers' copies never disappear.
   */
  readonly canceled: boolean;
  readonly sequence: number;
  readonly updatedAt: Temporal.Instant;
}

/**
 * Expand one series across `[from, until)`, applying its exceptions.
 *
 * Exceptions are matched on `occurrenceStart` — the generated slot —
 * which is why a moved occurrence stays addressable: the override
 * changes `startsAt` but never the identity it was filed under.
 *
 * A cancelled occurrence keeps its row rather than vanishing, so the
 * feed can publish the cancellation. Callers that render a page filter
 * on `canceled` themselves.
 */
export function occurrencesForSeries(
  series: EventSeries,
  exceptions: readonly EventExceptionRow[],
  from: Temporal.Instant,
  until: Temporal.Instant,
): CalendarOccurrence[] {
  const bySlot = new Map<string, EventExceptionRow>();
  for (const exception of exceptions) {
    bySlot.set(exception.occurrenceStart.toString(), exception);
  }

  const seriesCanceled = series.canceledAt !== null;

  return expandOccurrences(series, from, until).map((span) => {
    const exception = bySlot.get(span.occurrenceStart.toString());
    return {
      eventId: series.id,
      publicId: series.publicId,
      occurrenceStart: span.occurrenceStart,
      // NULL on an override column means "inherit from the series",
      // not "unset" — so an officer who later fixes the series title
      // sees it flow through to occurrences they had only moved.
      startsAt: exception?.startsAt ?? span.startsAt,
      endsAt: exception?.endsAt ?? span.endsAt,
      allDay: series.allDay,
      title: exception?.title ?? series.title,
      description: exception?.description ?? series.description,
      location: exception?.location ?? series.location,
      kind: series.kind,
      visibility: series.visibility,
      isRecurring: series.rrule !== null,
      canceled: seriesCanceled || (exception?.canceled ?? false),
      sequence: series.sequence,
      updatedAt: series.updatedAt,
    } satisfies CalendarOccurrence;
  });
}

/**
 * Expand many series into one chronological list.
 *
 * Sorted by start, then by `publicId` so the order is total and stable
 * — two events at 18:00 must not swap places between renders, or the
 * agenda list reshuffles under a reader on every poll.
 */
export function buildOccurrences(
  seriesList: readonly EventSeries[],
  exceptionsByEvent: ReadonlyMap<string, EventExceptionRow[]>,
  from: Temporal.Instant,
  until: Temporal.Instant,
): CalendarOccurrence[] {
  const out = seriesList.flatMap((series) =>
    occurrencesForSeries(
      series,
      exceptionsByEvent.get(series.id) ?? [],
      from,
      until,
    ),
  );

  out.sort((a, b) => {
    const byStart = Temporal.Instant.compare(a.startsAt, b.startsAt);
    return byStart !== 0 ? byStart : a.publicId.localeCompare(b.publicId);
  });
  return out;
}
