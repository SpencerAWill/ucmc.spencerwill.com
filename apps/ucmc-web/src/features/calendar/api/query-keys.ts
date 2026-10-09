/**
 * TanStack Query keys for the calendar.
 *
 * The month view is cached per window, because that is what the server
 * fn takes — `["calendar", "occurrences", fromMs, untilMs, kinds]`.
 * Paging to the next month is then a fresh entry rather than a refetch
 * of the same one, and paging *back* is instant.
 *
 * Every mutation invalidates the whole `["calendar"]` prefix rather than
 * a computed set of affected windows. A recurring series can contribute
 * to any window at all, and a cancellation has to reach every cached
 * month it appears in — working out which ones those are is exactly the
 * bookkeeping that left a stale gear detail page open in a tab.
 */
export const CALENDAR_QUERY_KEY = ["calendar"] as const;

export const calendarOccurrencesQueryKey = (
  fromMs: number,
  untilMs: number,
  kinds?: readonly string[],
) =>
  [
    ...CALENDAR_QUERY_KEY,
    "occurrences",
    fromMs,
    untilMs,
    kinds ? [...kinds].sort().join(",") : "all",
  ] as const;

/**
 * The caller's own subscription list. Not keyed by user id — the server
 * fn answers the current session and the query cache is per browser
 * session, rebuilt on sign-in and sign-out.
 */
export const MY_SUBSCRIPTIONS_QUERY_KEY = [
  "calendar",
  "my-subscriptions",
] as const;
