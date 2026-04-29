import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { removeAboutImageFn } from "#/features/landing/server/landing-fns";

export function useRemoveAboutImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => removeAboutImageFn(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_CONTENT_QUERY_KEY }),
  });
}
