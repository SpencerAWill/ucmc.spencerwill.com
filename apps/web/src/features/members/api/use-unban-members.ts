import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_DIRECTORY_QUERY_KEY,
  MEMBERS_REGISTRATIONS_QUERY_KEY,
  memberDetailQueryKey,
} from "#/features/members/api/query-keys";
import { unbanMembersFn } from "#/features/members/server/member-fns";

/**
 * Unban previously-banned members. Status flips back to `pending`
 * (re-enters approval queue), ban columns NULLed, and the user's
 * blocklist entries are auto-removed in the same step. Invalidates
 * directory, the management page's lifecycle tabs, and detail.
 */
export function useUnbanMembers(detailPublicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) => unbanMembersFn({ data: { userIds } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: MEMBERS_DIRECTORY_QUERY_KEY,
        }),
        queryClient.invalidateQueries({
          queryKey: MEMBERS_REGISTRATIONS_QUERY_KEY,
        }),
        detailPublicId
          ? queryClient.invalidateQueries({
              queryKey: memberDetailQueryKey(detailPublicId),
            })
          : Promise.resolve(),
      ]);
    },
  });
}
