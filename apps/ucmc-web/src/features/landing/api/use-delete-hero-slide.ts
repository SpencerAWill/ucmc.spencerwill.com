import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_QUERY_PREFIX } from "#/features/landing/api/query-keys";
import { deleteHeroSlideFn } from "#/features/landing/server/landing-fns";

export function useDeleteHeroSlide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string }) => deleteHeroSlideFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_QUERY_PREFIX }),
  });
}
