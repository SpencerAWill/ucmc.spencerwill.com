import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteMyAccountFn } from "#/features/auth/server/server-fns";

/**
 * Hard-deletes the caller's account. Server cascades through every
 * row that references the user and clears the session cookie; on
 * success we wipe the entire query cache because effectively no
 * cached query is still valid for this client.
 */
export function useDeleteMyAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteMyAccountFn(),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
