import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_DIRECTORY_QUERY_KEY,
  MEMBERS_REGISTRATIONS_QUERY_KEY,
  memberDetailQueryKey,
} from "#/features/members/api/query-keys";
import { reactivateMembersFn } from "#/features/members/server/member-fns";

/**
 * Reactivate previously-deactivated members. Status flips back to the
 * row's pre-deactivation value (typically `approved`). Invalidates
 * directory, the management page's lifecycle tabs, and detail.
 */
export function useReactivateMembers(detailPublicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      reactivateMembersFn({ data: { userIds } }),
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
