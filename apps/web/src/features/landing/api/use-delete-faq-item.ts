import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { deleteFaqItemFn } from "#/features/landing/server/landing-fns";

export function useDeleteFaqItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string }) => deleteFaqItemFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_CONTENT_QUERY_KEY }),
  });
}
