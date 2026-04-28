import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_REGISTRATIONS_QUERY_KEY,
  memberDetailQueryKey,
} from "#/features/members/api/query-keys";
import { unrejectMembersFn } from "#/features/members/server/member-fns";

/**
 * Move rejected users back to `pending` so they reappear in the
 * registrations queue. Invalidates the queue + any loaded detail pages.
 */
export function useUnrejectMembers(detailPublicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) => unrejectMembersFn({ data: { userIds } }),
    onSuccess: async () => {
      await Promise.all([
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
