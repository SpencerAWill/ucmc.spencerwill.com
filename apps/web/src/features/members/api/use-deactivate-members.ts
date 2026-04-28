import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_DIRECTORY_QUERY_KEY,
  MEMBERS_REGISTRATIONS_QUERY_KEY,
  memberDetailQueryKey,
} from "#/features/members/api/query-keys";
import { deactivateMembersFn } from "#/features/members/server/member-fns";

/**
 * Deactivate one or more approved members — sets status='deactivated'
 * and revokes their active sessions on the server. Invalidates the
 * directory (deactivated users disappear from default views) and any
 * loaded detail pages so badges/actions update.
 */
export function useDeactivateMembers(detailPublicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      deactivateMembersFn({ data: { userIds } }),
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
