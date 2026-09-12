import { useMutation, useQueryClient } from "@tanstack/react-query";

import { VOLUNTEER_CONTENT_QUERY_KEY } from "#/features/volunteer/api/query-keys";
import {
  createEventFn,
  deleteEventFn,
  updateEventFn,
} from "#/features/volunteer/server/volunteer-fns";
import type {
  CreateEventInput,
  DeleteByIdInput,
  UpdateEventInput,
} from "#/features/volunteer/server/volunteer-schemas";

/**
 * Create / update / delete a dated outing. Editing an outing's start
 * date can move it between the "Coming up" and "Our record" bands, so
 * these invalidate the whole page bundle rather than trying to patch one
 * list in place.
 */
export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateEventInput) => createEventFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: VOLUNTEER_CONTENT_QUERY_KEY }),
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateEventInput) => updateEventFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: VOLUNTEER_CONTENT_QUERY_KEY }),
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DeleteByIdInput) => deleteEventFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: VOLUNTEER_CONTENT_QUERY_KEY }),
  });
}
