import { useMutation, useQueryClient } from "@tanstack/react-query";

import { MY_SUBSCRIPTIONS_QUERY_KEY } from "#/features/calendar/api/query-keys";
import {
  createMySubscriptionFn,
  revokeMySubscriptionFn,
  rotateMySubscriptionFn,
} from "#/features/calendar/server/calendar-fns";
import type {
  CreateSubscriptionInput,
  SubscriptionIdInput,
} from "#/features/calendar/server/event-schemas";

/**
 * Subscription lifecycle. All three invalidate the one list entry.
 *
 * **The minted token is returned to the caller and never cached.** It
 * lives in component state for as long as the member needs to copy it
 * and is gone on the next render of the page — putting it in the query
 * cache would persist a bearer credential across navigations for no
 * benefit, since the list query deliberately does not carry tokens.
 */
export function useCreateSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSubscriptionInput) =>
      createMySubscriptionFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: MY_SUBSCRIPTIONS_QUERY_KEY }),
  });
}

export function useRevokeSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SubscriptionIdInput) => revokeMySubscriptionFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: MY_SUBSCRIPTIONS_QUERY_KEY }),
  });
}

export function useRotateSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SubscriptionIdInput) => rotateMySubscriptionFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: MY_SUBSCRIPTIONS_QUERY_KEY }),
  });
}
