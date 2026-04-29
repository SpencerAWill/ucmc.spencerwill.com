import { useMutation, useQueryClient } from "@tanstack/react-query";

import { PROFILE_QUERY_KEY } from "#/features/auth/api/query-keys";
import { submitDetailsFn } from "#/features/auth/server/server-fns";
import type { DetailsInput } from "#/server/profile/profile-schemas";

/**
 * Partial update for the /account Details tab — fullName, phone,
 * emergency contacts. Doesn't touch session state or the user row's
 * status, so only the profile cache needs to invalidate.
 */
export function useSubmitDetails() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DetailsInput) => submitDetailsFn({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
    },
  });
}
