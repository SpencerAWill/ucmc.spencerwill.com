import { useMutation, useQueryClient } from "@tanstack/react-query";

import { memberDetailQueryKey } from "#/features/members/api/query-keys";
import { revokeUserSessionsFn } from "#/features/members/server/member-fns";

/**
 * Force-sign-out a user by revoking all their active sessions. The
 * user stays in their current status (e.g. approved) but loses every
 * device cookie. Invalidates the corresponding detail page so the
 * activeSessions count drops to zero.
 */
export function useRevokeUserSessions(detailPublicId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => revokeUserSessionsFn({ data: { userId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: memberDetailQueryKey(detailPublicId),
      });
    },
  });
}
