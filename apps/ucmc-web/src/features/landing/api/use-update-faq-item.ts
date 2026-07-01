import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { updateFaqItemFn } from "#/features/landing/server/landing-fns";
import type { FaqUpdateInput } from "#/features/landing/server/landing-schemas";

export function useUpdateFaqItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: FaqUpdateInput) => updateFaqItemFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_CONTENT_QUERY_KEY }),
  });
}
