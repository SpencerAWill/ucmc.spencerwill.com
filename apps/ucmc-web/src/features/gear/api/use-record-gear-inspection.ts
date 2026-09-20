import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  COUNTED_MODELS_FOR_INSPECTION_QUERY_KEY,
  GEAR_MODELS_QUERY_KEY,
  gearDetailQueryKey,
  gearInspectionsQueryKey,
  gearModelInspectionsQueryKey,
} from "#/features/gear/api/query-keys";
import { recordGearInspectionFn } from "#/features/gear/server/gear-fns";
import type { RecordGearInspectionInput } from "#/features/gear/server/gear-fns";

/** What was inspected: one coded piece, or a counted model as a batch.
 *  The two invalidate different things, so the hook is told which. */
export type GearInspectionTarget =
  | { kind: "item"; publicId: string }
  | { kind: "model"; publicId: string };

export function useRecordGearInspection(target: GearInspectionTarget) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordGearInspectionInput) =>
      recordGearInspectionFn({ data: input }),
    onSuccess: async (result) => {
      if (!result.ok) {
        return;
      }
      if (target.kind === "item") {
        // The inspections list for this gear plus its detail payload —
        // the latter so the "latest inspection" summary on the detail
        // card refreshes with it.
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: gearInspectionsQueryKey(target.publicId),
          }),
          queryClient.invalidateQueries({
            queryKey: gearDetailQueryKey(target.publicId),
          }),
        ]);
        return;
      }
      // A model's batch log, the models prefix (the clock on the model
      // row is derived from the newest of these), and the inspection
      // worklist — which is sorted by exactly the value just written,
      // so the bin that was stalest should drop to the bottom.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: gearModelInspectionsQueryKey(target.publicId),
        }),
        queryClient.invalidateQueries({ queryKey: GEAR_MODELS_QUERY_KEY }),
        queryClient.invalidateQueries({
          queryKey: COUNTED_MODELS_FOR_INSPECTION_QUERY_KEY,
        }),
      ]);
    },
  });
}
