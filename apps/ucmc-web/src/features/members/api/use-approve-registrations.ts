import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_DIRECTORY_QUERY_KEY,
  MEMBERS_REGISTRATIONS_QUERY_KEY,
} from "#/features/members/api/query-keys";
import { approveRegistrationsFn } from "#/features/members/server/member-fns";

/**
 * Approve one or more pending users — moves their status from
 * `pending` to `approved`. Invalidates the registrations queue (rows
 * disappear) and the directory (now-approved users become visible).
 */
export function useApproveRegistrations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      approveRegistrationsFn({ data: { userIds } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: MEMBERS_REGISTRATIONS_QUERY_KEY,
        }),
        queryClient.invalidateQueries({
          queryKey: MEMBERS_DIRECTORY_QUERY_KEY,
        }),
      ]);
    },
  });
}
