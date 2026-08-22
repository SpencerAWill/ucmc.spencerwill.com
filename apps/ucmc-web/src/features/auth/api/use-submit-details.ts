import { useMutation, useQueryClient } from "@tanstack/react-query";

import { PROFILE_QUERY_KEY } from "#/features/auth/api/query-keys";
import { submitDetailsFn } from "#/features/auth/server/server-fns";
import type { DetailsInput } from "#/server/profile/profile-schemas";

/**
 * Partial update for the private-profile columns — fullName, phone,
 * emergency contacts. Shared by `/my/details` (which edits name +
 * phone) and `/my/contacts` (which edits the contacts); each page
 * passes the other's fields through unchanged from the loaded profile,
 * because this takes the whole `detailsInputSchema` shape rather than a
 * partial. Doesn't touch session state or the user row's status, so
 * only the profile cache needs to invalidate.
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
