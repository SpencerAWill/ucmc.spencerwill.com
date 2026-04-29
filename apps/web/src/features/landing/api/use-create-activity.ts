import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { createActivityFn } from "#/features/landing/server/landing-fns";
import type { ActivityInput } from "#/features/landing/server/landing-schemas";

export function useCreateActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ActivityInput) => createActivityFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_CONTENT_QUERY_KEY }),
  });
}
