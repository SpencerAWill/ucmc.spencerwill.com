import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  MEMBERS_DIRECTORY_QUERY_KEY,
  memberDetailQueryKey,
} from "#/features/members/api/query-keys";
import { adminUpdateProfileFn } from "#/features/members/server/member-fns";
import type { ProfileInput } from "#/server/profile/profile-schemas";

interface Input extends ProfileInput {
  userId: string;
}

/**
 * Admin-side profile edit. Targets a specific user by id (not the
 * caller's own profile). Caller supplies the publicId of the detail
 * page being edited so the hook can refresh that cache. Also
 * invalidates the directory because preferredName + the badge fields
 * render inline there.
 */
export function useAdminUpdateProfile(detailPublicId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Input) => adminUpdateProfileFn({ data: input }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: memberDetailQueryKey(detailPublicId),
        }),
        queryClient.invalidateQueries({
          queryKey: MEMBERS_DIRECTORY_QUERY_KEY,
        }),
      ]);
    },
  });
}
