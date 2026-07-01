import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { removeMeetingImageFn } from "#/features/landing/server/landing-fns";

export function useRemoveMeetingImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => removeMeetingImageFn(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_CONTENT_QUERY_KEY }),
  });
}
