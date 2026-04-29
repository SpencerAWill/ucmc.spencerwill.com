import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { reorderHeroSlidesFn } from "#/features/landing/server/landing-fns";

export function useReorderHeroSlides() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { ids: string[] }) => reorderHeroSlidesFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_CONTENT_QUERY_KEY }),
  });
}
