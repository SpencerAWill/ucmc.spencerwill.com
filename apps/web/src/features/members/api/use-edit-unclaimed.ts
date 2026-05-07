import { useMutation, useQueryClient } from "@tanstack/react-query";

import { MEMBERS_UNCLAIMED_QUERY_KEY } from "#/features/members/api/query-keys";
import { editUnclaimedFn } from "#/features/members/server/member-fns";
import type { EditUnclaimedInput } from "#/features/members/server/member-fns";

/**
 * Edit an unclaimed member's placeholder name and/or primary email.
 * The server returns a discriminated result — successful save
 * invalidates the unclaimed list; an `email_taken` / `not_found` /
 * `not_unclaimed` error is surfaced to the caller via `onSuccess`.
 */
export function useEditUnclaimed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EditUnclaimedInput) => editUnclaimedFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        await queryClient.invalidateQueries({
          queryKey: MEMBERS_UNCLAIMED_QUERY_KEY,
        });
      }
    },
  });
}
