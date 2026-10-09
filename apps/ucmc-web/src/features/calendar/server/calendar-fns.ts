/**
 * Route-facing shells for the club calendar's server fns (issue #187).
 *
 * Each handler body dynamic-imports its action so server-only modules
 * never reach the client bundle; type-only imports of action shapes
 * erase at compile time and are fine.
 */
import { createServerFn } from "@tanstack/react-start";

import { calendarWindowInputSchema } from "#/features/calendar/server/event-schemas";
import type { CalendarOccurrence } from "#/server/events/occurrences";

export type { CalendarOccurrence } from "#/server/events/occurrences";

// ── reads (projected per viewer; see event-actions.server.ts) ───────────

export const listCalendarOccurrencesFn = createServerFn({ method: "GET" })
  .validator(calendarWindowInputSchema)
  .handler(async ({ data }): Promise<CalendarOccurrence[]> => {
    const { listCalendarOccurrencesAction } =
      await import("#/features/calendar/server/event-actions.server");
    return listCalendarOccurrencesAction(data);
  });
