import { useMutation, useQueryClient } from "@tanstack/react-query";

import { SESSION_QUERY_KEY } from "#/features/auth/api/query-keys";
import { consumeMagicLinkFn } from "#/features/auth/server/server-fns";

/**
 * Consume a magic-link token. The server sets a session cookie (or a
 * proof cookie for first-time registrants) and returns a result whose
 * `mode` + `hasProfile` + `status` fields drive the post-consume
 * navigation decision in /auth/callback.
 *
 * Invalidates the session query cache on success so any consumer that
 * was reading `principal: null` from the SSR pass refetches and sees
 * the freshly-opened session.
 */
export function useConsumeMagicLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => consumeMagicLinkFn({ data: { token } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });
}
