import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { reorderFaqItemsFn } from "#/features/landing/server/landing-fns";

export function useReorderFaqItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { ids: string[] }) => reorderFaqItemsFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_CONTENT_QUERY_KEY }),
  });
}
