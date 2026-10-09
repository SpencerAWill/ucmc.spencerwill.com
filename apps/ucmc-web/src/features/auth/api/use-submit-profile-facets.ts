import { useMutation, useQueryClient } from "@tanstack/react-query";

import { PROFILE_QUERY_KEY } from "#/features/auth/api/query-keys";
import { submitProfileFacetsFn } from "#/features/auth/server/server-fns";
import type { ProfileFacetsInput } from "#/server/profile/profile-schemas";

/**
 * Replaces the member's answered prompts and self-rated disciplines.
 *
 * Only the profile cache invalidates, matching
 * `useSubmitPublicProfile`: the member's own `/members/$publicId`
 * entry keys on `publicId`, which this caller does not hold, and the
 * members feature's query keys are not reachable from `auth` anyway.
 * A member who edits their prompts and then opens their own profile
 * page navigates, which refetches.
 */
export function useSubmitProfileFacets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProfileFacetsInput) => submitProfileFacetsFn({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
    },
  });
}
