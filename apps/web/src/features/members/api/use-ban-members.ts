import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_DIRECTORY_QUERY_KEY,
  MEMBERS_REGISTRATIONS_QUERY_KEY,
  memberDetailQueryKey,
} from "#/features/members/api/query-keys";
import { banMembersFn } from "#/features/members/server/member-fns";

/**
 * Ban one or more non-unclaimed users. Sets status='banned', mirrors
 * their verified emails into `banned_emails`, purges live sessions.
 * Invalidates the directory + lifecycle tabs + any open detail page —
 * a banned user disappears from default directory views and surfaces
 * on the management page's Banned tab.
 */
export function useBanMembers(detailPublicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userIds, reason }: { userIds: string[]; reason: string }) =>
      banMembersFn({ data: { userIds, reason } }),
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
