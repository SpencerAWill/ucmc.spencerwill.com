import { useMutation, useQueryClient } from "@tanstack/react-query";

import { MY_NOTIFICATION_PREFS_QUERY_KEY } from "#/features/auth/api/query-keys";
import { setMyNotificationPreferenceFn } from "#/features/auth/server/notification-prefs-fns";

/**
 * Flip one notification category on or off for the caller.
 *
 * Invalidates only the preference list. Nothing else renders a
 * preference — the session principal doesn't carry them, deliberately,
 * since the only reader that matters is the cron, which goes to D1.
 *
 * No optimistic update: the server can legitimately refuse
 * (`not_suppressible`), and a switch that flips and then flips back is
 * worse than one that waits a beat.
 */
export function useSetNotificationPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { category: string; enabled: boolean }) =>
      setMyNotificationPreferenceFn({ data: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: MY_NOTIFICATION_PREFS_QUERY_KEY,
      });
    },
  });
}
