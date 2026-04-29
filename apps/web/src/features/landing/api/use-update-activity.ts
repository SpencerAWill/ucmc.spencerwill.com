import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { updateActivityFn } from "#/features/landing/server/landing-fns";
import type { ActivityUpdateInput } from "#/features/landing/server/landing-schemas";

export function useUpdateActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ActivityUpdateInput) => updateActivityFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_CONTENT_QUERY_KEY }),
  });
}
