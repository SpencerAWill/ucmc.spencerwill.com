import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
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
        ...input.items.map((item) =>
          qc.invalidateQueries({
            queryKey: gearDetailQueryKey(item.gearPublicId),
          }),
        ),
      ]);
    },
  });
}
