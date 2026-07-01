import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { createFaqItemFn } from "#/features/landing/server/landing-fns";
import type { FaqInput } from "#/features/landing/server/landing-schemas";

export function useCreateFaqItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: FaqInput) => createFaqItemFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_CONTENT_QUERY_KEY }),
  });
}
