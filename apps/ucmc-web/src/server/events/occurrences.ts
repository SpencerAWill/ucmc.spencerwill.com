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
  /**
   * The series' rule, or NULL for a one-off.
   *
   * Carried through rather than reduced to an `isRecurring` boolean so
   * the officer edit dialog can seed its repeat controls from the same
   * payload the page already has — the alternative is a second fetch
   * for a string the client was one field away from holding. Not
   * sensitive: an occurrence the viewer may see implies a schedule they
   * may see.
   */
  readonly rrule: string | null;
  /**
   * The SERIES' own anchor — `events.starts_at`, not this occurrence's.
   *
   * Carried so the officer edit dialog can seed from the series rather
   * than from whichever occurrence happened to be open. Seeding from
   * the occurrence silently re-anchors the whole series on save: open
   * the May 13 instance of a weekly series anchored in January, fix a
   * typo, and every occurrence before May 13 disappears — from the page
   * and from `DTSTART` in every subscriber's feed — while
   * `updateEventAction` additionally clears every exception, because it
   * correctly sees the anchor as moved.
   */
  readonly seriesStartsAt: Temporal.Instant;
  readonly seriesEndsAt: Temporal.Instant | null;
  /**
   * The two cancellation flags, kept apart because they mean different
   * things and drive different controls: calling off a whole series is
   * not the same act as skipping one week, and an officer needs to be
   * offered the one they meant.
   *
   * Conflating them made both controls lie — with the series cancelled,
   * every occurrence read as cancelled, so the per-occurrence button
   * offered "put this one back" and cleared an override that was never
   * there.
   */
  readonly seriesCanceled: boolean;
  readonly occurrenceCanceled: boolean;
  /**
   * Either of the above — the display flag.
   *
   * Kept in the payload rather than derived at each of the five call
   * sites that render a strikethrough, a badge or a `STATUS:` line.
   * Occurrences are kept in the list rather than filtered out: the page
   * drops them, but the feed has to *publish* them as
   * `STATUS:CANCELLED` or subscribers' copies never disappear.
   */
  readonly canceled: boolean;
  readonly sequence: number;
  readonly updatedAt: Temporal.Instant;
}

/**
 * The span an override resolves to, given what the series generated.
 *
 * **Moving an occurrence preserves its length.** An override that sets
 * `startsAt` and leaves `endsAt` null means "same event, later that
 * day" — so the end shifts by the same amount. Inheriting the
 * generated end raw instead produces an occurrence that ends before it
 * starts the moment anyone moves one later: a 18:00–19:00 slot moved
 * to 20:00 would render "8:00 PM – 7:00 PM".
 *
 * An override that sets both is taken at its word.
 */
function resolveOverrideSpan(
  exception: EventExceptionRow,
  generatedStart: Temporal.Instant,
  generatedEnd: Temporal.Instant | null,
): { startsAt: Temporal.Instant; endsAt: Temporal.Instant | null } {
  const startsAt = exception.startsAt ?? generatedStart;

  if (exception.endsAt !== null) {
    return { startsAt, endsAt: exception.endsAt };
  }
  if (exception.startsAt === null || generatedEnd === null) {
    return { startsAt, endsAt: generatedEnd };
  }
  const length = generatedStart.until(generatedEnd);
  return { startsAt, endsAt: startsAt.add(length) };
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
    const occurrenceCanceled = exception?.canceled ?? false;
    const resolved = exception
      ? resolveOverrideSpan(exception, span.startsAt, span.endsAt)
      : { startsAt: span.startsAt, endsAt: span.endsAt };
    return {
      eventId: series.id,
      publicId: series.publicId,
      occurrenceStart: span.occurrenceStart,
      // NULL on an override column means "inherit from the series",
      // not "unset" — so an officer who later fixes the series title
      // sees it flow through to occurrences they had only moved. The
      // start/end pair is resolved together, so a move keeps its length.
      startsAt: resolved.startsAt,
      endsAt: resolved.endsAt,
      allDay: series.allDay,
      title: exception?.title ?? series.title,
      description: exception?.description ?? series.description,
      location: exception?.location ?? series.location,
      kind: series.kind,
      visibility: series.visibility,
      rrule: series.rrule,
      seriesStartsAt: series.startsAt,
      seriesEndsAt: series.endsAt,
      seriesCanceled,
      occurrenceCanceled,
      canceled: seriesCanceled || occurrenceCanceled,
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

/**
 * A series as a single occurrence-shaped record, *unexpanded*.
 *
 * What the `.ics` feed renders: one VEVENT carrying the series' RRULE,
 * rather than one per occurrence. Clients expand it themselves, which
 * is what the format is for — and an expanded feed would have a
 * horizon, so a member who subscribes and never opens the site again
 * would silently stop seeing the weekly meeting the day that horizon
 * passed.
 */
export function seriesAsOccurrence(series: EventSeries): CalendarOccurrence {
  return {
    eventId: series.id,
    publicId: series.publicId,
    occurrenceStart: series.startsAt,
    startsAt: series.startsAt,
    endsAt: series.endsAt,
    allDay: series.allDay,
    title: series.title,
    description: series.description,
    location: series.location,
    kind: series.kind,
    visibility: series.visibility,
    rrule: series.rrule,
    seriesStartsAt: series.startsAt,
    seriesEndsAt: series.endsAt,
    seriesCanceled: series.canceledAt !== null,
    occurrenceCanceled: false,
    canceled: series.canceledAt !== null,
    sequence: series.sequence,
    updatedAt: series.updatedAt,
  };
}

/**
 * One occurrence of a series as modified by an exception.
 *
 * Carries no RRULE: an override is the same UID with a RECURRENCE-ID
 * naming the slot it replaces, and repeating the rule would have the
 * client read it as a second infinite series.
 */
export function overrideAsOccurrence(
  series: EventSeries,
  exception: EventExceptionRow,
  fallbackStart: Temporal.Instant,
  fallbackEnd: Temporal.Instant | null,
): CalendarOccurrence {
  const resolved = resolveOverrideSpan(exception, fallbackStart, fallbackEnd);
  return {
    ...seriesAsOccurrence(series),
    rrule: null,
    occurrenceStart: exception.occurrenceStart,
    startsAt: resolved.startsAt,
    endsAt: resolved.endsAt,
    title: exception.title ?? series.title,
    description: exception.description ?? series.description,
    location: exception.location ?? series.location,
    occurrenceCanceled: exception.canceled,
    canceled: series.canceledAt !== null || exception.canceled,
  };
}
