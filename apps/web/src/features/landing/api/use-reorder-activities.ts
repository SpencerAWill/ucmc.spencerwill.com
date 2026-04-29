import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { reorderActivitiesFn } from "#/features/landing/server/landing-fns";

export function useReorderActivities() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { ids: string[] }) => reorderActivitiesFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_CONTENT_QUERY_KEY }),
  });
}
