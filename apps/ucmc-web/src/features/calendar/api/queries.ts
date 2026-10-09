import { calendarOccurrencesQueryKey } from "#/features/calendar/api/query-keys";
import { listCalendarOccurrencesFn } from "#/features/calendar/server/calendar-fns";
import type { EventKind } from "#/../drizzle/schema";

/**
 * Occurrences overlapping a window, as the viewer may see them.
 *
 * **The payload is viewer-dependent** — an officer sees
 * `visibility = 'officers'` events a member does not — so this entry
 * must never be shared across identities. It isn't: the query cache is
 * per browser session and is rebuilt on sign-in / sign-out, and nothing
 * caches server-fn responses at the edge.
 *
 * A one-minute `staleTime`: the club's schedule changes a few times a
 * semester, but an officer who has just published a trip expects to see
 * it on their own calendar, and the mutation hooks invalidate anyway.
 */
export function calendarOccurrencesQueryOptions(
  from: Temporal.Instant,
  until: Temporal.Instant,
  kinds?: readonly EventKind[],
) {
  const fromMs = from.epochMilliseconds;
  const untilMs = until.epochMilliseconds;
  return {
    queryKey: calendarOccurrencesQueryKey(fromMs, untilMs, kinds),
    queryFn: () =>
      listCalendarOccurrencesFn({
        data: {
          from: fromMs,
          until: untilMs,
          ...(kinds ? { kinds: [...kinds] } : {}),
        },
      }),
    staleTime: 60_000,
  } as const;
}
