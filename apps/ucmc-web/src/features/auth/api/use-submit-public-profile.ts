import { useMutation, useQueryClient } from "@tanstack/react-query";

import { PROFILE_QUERY_KEY } from "#/features/auth/api/query-keys";
import { submitPublicProfileFn } from "#/features/auth/server/server-fns";
import type { PublicProfileInput } from "#/server/profile/profile-schemas";

/**
 * Partial update for the /account Profile tab — preferredName, UC
 * affiliation, bio. Doesn't touch session state or the user row's
 * status, so only the profile cache needs to invalidate.
 */
export function useSubmitPublicProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: PublicProfileInput) => submitPublicProfileFn({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
    },
  });
}
