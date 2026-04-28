import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  PROFILE_QUERY_KEY,
  SESSION_QUERY_KEY,
} from "#/features/auth/api/query-keys";
import { submitProfileFn } from "#/features/auth/server/server-fns";
import type { ProfileInput } from "#/server/profile/profile-schemas";

/**
 * First-time profile submission (the registration funnel). Server
 * upserts the user + profile rows, opens a session if the caller only
 * had a proof cookie, and clears the proof. On success invalidates the
 * session query (status changed from anonymous → pending) and the
 * cached profile row.
 */
export function useSubmitProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProfileInput) => submitProfileFn({ data }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY }),
      ]);
    },
  });
}
