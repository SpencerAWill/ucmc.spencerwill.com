import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { setMeetingImageFn } from "#/features/landing/server/landing-fns";
import type { SetSectionImageInput } from "#/features/landing/server/landing-schemas";

export function useSetMeetingImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SetSectionImageInput) => setMeetingImageFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_CONTENT_QUERY_KEY }),
  });
}
