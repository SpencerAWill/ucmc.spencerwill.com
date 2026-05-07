import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MY_EMAILS_QUERY_KEY,
  SESSION_QUERY_KEY,
} from "#/features/auth/api/query-keys";
import { consumeAddEmailFn } from "#/features/auth/server/email-fns";

/**
 * Verify an "add email" magic-link token: attaches the email to the
 * caller's account when `result.ok`, leaves the account untouched
 * otherwise. The server fn returns a discriminated `{ ok: true, email }
 * | { ok: false, reason }`, so the call site (today, `/verify-email`)
 * branches on `result.ok` from its own `onSuccess` to drive UI.
 *
 * Cache invalidation is gated on the success branch — there's no
 * server-side state change to reflect when the consume fails.
 * Invalidates the email list (so `/my/account/details` shows the new
 * row) and the session (so `principal.emails` reflects the addition
 * without waiting for the next navigation).
 */
export function useConsumeAddEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { token: string }) =>
      consumeAddEmailFn({ data: input }),
    onSuccess: async (result) => {
      if (!result.ok) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MY_EMAILS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
      ]);
    },
  });
}
