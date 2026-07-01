import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  gearDetailQueryKey,
  gearInspectionsQueryKey,
} from "#/features/gear/api/query-keys";
import { recordGearInspectionFn } from "#/features/gear/server/gear-fns";
import type { RecordGearInspectionInput } from "#/features/gear/server/gear-fns";

export function useRecordGearInspection(gearPublicId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordGearInspectionInput) =>
      recordGearInspectionFn({ data: input }),
    onSuccess: async () => {
      // Invalidate the inspections list for this gear plus its detail
      // payload (the latter so any "latest inspection" summary on the
      // detail card refreshes).
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: gearInspectionsQueryKey(gearPublicId),
        }),
        queryClient.invalidateQueries({
          queryKey: gearDetailQueryKey(gearPublicId),
        }),
      ]);
    },
  });
}
