import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MY_EMAILS_QUERY_KEY,
  SESSION_QUERY_KEY,
} from "#/features/auth/api/query-keys";
import { removeEmailFn } from "#/features/auth/server/email-fns";

/**
 * Remove an email from the user's account. Invalidates both the email
 * list (so the row disappears from `/my/details`) and the
 * session (so `principal.emails` reflects the removal — the cached
 * principal would otherwise still list the deleted address until the
 * next navigation forced a refetch).
 */
export function useRemoveEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (emailId: string) => removeEmailFn({ data: { emailId } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MY_EMAILS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
      ]);
    },
  });
}
