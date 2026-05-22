import { useMutation, useQueryClient } from "@tanstack/react-query";

import { HISTORY_CONTENT_QUERY_KEY } from "#/features/history/api/query-keys";
import { updateNarrativeFn } from "#/features/history/server/history-fns";
import type { UpdateNarrativeInput } from "#/features/history/server/history-schemas";

export function useUpdateHistoryNarrative() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateNarrativeInput) => updateNarrativeFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: HISTORY_CONTENT_QUERY_KEY }),
  });
}
