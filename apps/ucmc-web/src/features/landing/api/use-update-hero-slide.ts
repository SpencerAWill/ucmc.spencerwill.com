import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_QUERY_PREFIX } from "#/features/landing/api/query-keys";
import { updateHeroSlideFn } from "#/features/landing/server/landing-fns";
import type { UpdateHeroSlideInput } from "#/features/landing/server/landing-schemas";

export function useUpdateHeroSlide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateHeroSlideInput) => updateHeroSlideFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_QUERY_PREFIX }),
  });
}
