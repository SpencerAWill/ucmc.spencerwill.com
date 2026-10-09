import { useMutation, useQueryClient } from "@tanstack/react-query";

import { CALENDAR_QUERY_KEY } from "#/features/calendar/api/query-keys";
import {
  cancelEventFn,
  clearOccurrenceOverrideFn,
  createEventFn,
  deleteEventFn,
  overrideOccurrenceFn,
  updateEventFn,
} from "#/features/calendar/server/calendar-fns";
import type {
  CancelEventInput,
  ClearOccurrenceOverrideInput,
  CreateEventInput,
  DeleteEventInput,
  OverrideOccurrenceInput,
  UpdateEventInput,
} from "#/features/calendar/server/event-schemas";

/**
 * Calendar mutations.
 *
 * **Every one invalidates the whole `["calendar"]` prefix**, not a
 * computed set of affected month windows. That is deliberate rather
 * than lazy: a recurring series can contribute occurrences to any
 * window at all, so the set of months a single edit touches is
 * unbounded — and a cancellation has to reach every cached month it
 * appears in. Working out which entries those are is exactly the
 * bookkeeping that left a stale gear detail page open in a tab after a
 * model rename. The cached entries are one network round-trip each and
 * the officer has just done something they expect to see.
 */
function useCalendarInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEY });
}

export function useCreateEvent() {
  const invalidate = useCalendarInvalidation();
  return useMutation({
    mutationFn: (data: CreateEventInput) => createEventFn({ data }),
    onSuccess: invalidate,
  });
}

export function useUpdateEvent() {
  const invalidate = useCalendarInvalidation();
  return useMutation({
    mutationFn: (data: UpdateEventInput) => updateEventFn({ data }),
    onSuccess: invalidate,
  });
}

export function useCancelEvent() {
  const invalidate = useCalendarInvalidation();
  return useMutation({
    mutationFn: (data: CancelEventInput) => cancelEventFn({ data }),
    onSuccess: invalidate,
  });
}

export function useDeleteEvent() {
  const invalidate = useCalendarInvalidation();
  return useMutation({
    mutationFn: (data: DeleteEventInput) => deleteEventFn({ data }),
    onSuccess: invalidate,
  });
}

export function useOverrideOccurrence() {
  const invalidate = useCalendarInvalidation();
  return useMutation({
    mutationFn: (data: OverrideOccurrenceInput) =>
      overrideOccurrenceFn({ data }),
    onSuccess: invalidate,
  });
}

export function useClearOccurrenceOverride() {
  const invalidate = useCalendarInvalidation();
  return useMutation({
    mutationFn: (data: ClearOccurrenceOverrideInput) =>
      clearOccurrenceOverrideFn({ data }),
    onSuccess: invalidate,
  });
}
