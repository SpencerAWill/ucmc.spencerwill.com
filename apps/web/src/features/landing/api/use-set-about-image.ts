import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { setAboutImageFn } from "#/features/landing/server/landing-fns";
import type { SetSectionImageInput } from "#/features/landing/server/landing-schemas";

export function useSetAboutImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SetSectionImageInput) => setAboutImageFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_CONTENT_QUERY_KEY }),
  });
}
