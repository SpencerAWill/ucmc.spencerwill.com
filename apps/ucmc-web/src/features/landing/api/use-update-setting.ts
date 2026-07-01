import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import { updateLandingSettingFn } from "#/features/landing/server/landing-fns";
import type { UpdateSettingInput } from "#/features/landing/server/landing-schemas";

export function useUpdateLandingSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateSettingInput) => updateLandingSettingFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: LANDING_CONTENT_QUERY_KEY }),
  });
}
