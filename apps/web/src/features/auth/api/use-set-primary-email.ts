import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MY_EMAILS_QUERY_KEY,
  SESSION_QUERY_KEY,
} from "#/features/auth/api/query-keys";
import { setPrimaryEmailFn } from "#/features/auth/server/email-fns";

/**
 * Promote one of the user's verified emails to primary. Invalidates
 * both the email list (the badge moves) and the session (Principal's
 * `primaryEmail` is now stale and the user-menu / avatar fallback
 * read it).
 */
export function useSetPrimaryEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (emailId: string) => setPrimaryEmailFn({ data: { emailId } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MY_EMAILS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
      ]);
    },
  });
}
