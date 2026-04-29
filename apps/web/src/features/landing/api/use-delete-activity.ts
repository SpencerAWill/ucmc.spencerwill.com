import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { deleteActivityFn } from "#/features/landing/server/landing-fns";

export function useDeleteActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string }) => deleteActivityFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_CONTENT_QUERY_KEY }),
  });
}
