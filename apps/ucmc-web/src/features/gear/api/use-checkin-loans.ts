import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_MODELS_QUERY_KEY,
  GEAR_QUERY_KEY,
  LOANS_QUERY_KEY,
  MY_LOANS_QUERY_KEY,
  gearDetailQueryKey,
} from "#/features/gear/api/query-keys";
import { checkinLoansFn } from "#/features/gear/server/gear-fns";
import type { CheckinLoansInput } from "#/features/gear/server/gear-fns";

/**
 * Bulk check-in: marks N loans returned in one mutation. Each row may
 * close a loan belonging to a different member — that's the whole
 * point of letting checkin span borrowers.
 *
 * Invalidates the same keys as checkout, for the same reasons — a
 * counted return releases units back into the models' `takeable`, so
 * `GEAR_MODELS_QUERY_KEY` joins only when a counted row was in the
 * batch. A counted row has no item page, so it pins no detail key.
 */
export function useCheckinLoans() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CheckinLoansInput) => checkinLoansFn({ data: input }),
    onSuccess: async (_data, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: LOANS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: MY_LOANS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: GEAR_QUERY_KEY }),
        ...input.items.flatMap((item) =>
          item.kind === "coded"
            ? [
                qc.invalidateQueries({
                  queryKey: gearDetailQueryKey(item.gearPublicId),
                }),
              ]
            : [],
        ),
        ...(input.items.some((item) => item.kind === "counted")
          ? [qc.invalidateQueries({ queryKey: GEAR_MODELS_QUERY_KEY })]
          : []),
      ]);
    },
  });
}
