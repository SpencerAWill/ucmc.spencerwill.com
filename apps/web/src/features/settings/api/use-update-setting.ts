import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  PUBLIC_FLAGS_QUERY_KEY,
  PUBLIC_SITE_CONTACT_QUERY_KEY,
  SITE_SETTINGS_QUERY_KEY,
} from "./query-keys";
import { updateSettingFn } from "#/features/settings/server/settings-fns";
import type { UpdateSettingInput } from "#/features/settings/server/settings-fns";

export function useUpdateSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingInput) => updateSettingFn({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: SITE_SETTINGS_QUERY_KEY }),
          queryClient.invalidateQueries({
            queryKey: PUBLIC_SITE_CONTACT_QUERY_KEY,
          }),
          queryClient.invalidateQueries({ queryKey: PUBLIC_FLAGS_QUERY_KEY }),
        ]);
      }
    },
  });
}
