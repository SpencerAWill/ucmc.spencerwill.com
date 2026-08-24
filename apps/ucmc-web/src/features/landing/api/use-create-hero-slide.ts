import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_QUERY_PREFIX } from "#/features/landing/api/query-keys";
import { createHeroSlideFn } from "#/features/landing/server/landing-fns";
import type { CreateHeroSlideInput } from "#/features/landing/server/landing-schemas";

export function useCreateHeroSlide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateHeroSlideInput) => createHeroSlideFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_QUERY_PREFIX }),
  });
}
