import { useMutation, useQueryClient } from "@tanstack/react-query";

import { MEMBERS_REGISTRATIONS_QUERY_KEY } from "#/features/members/api/query-keys";
import { rejectRegistrationsFn } from "#/features/members/server/member-fns";

/**
 * Reject one or more pending users — moves their status from
 * `pending` to `rejected`. Rejected users disappear from the queue but
 * their row stays so the same person can be unrejected later.
 */
export function useRejectRegistrations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      rejectRegistrationsFn({ data: { userIds } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: MEMBERS_REGISTRATIONS_QUERY_KEY,
      });
    },
  });
}
