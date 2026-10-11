import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_MODELS_QUERY_KEY,
  LOANS_QUERY_KEY,
  MY_LOANS_QUERY_KEY,
  loanDetailQueryKey,
} from "#/features/gear/api/query-keys";
import { writeOffLoanShortfallFn } from "#/features/gear/server/gear-fns";

/**
 * Close a counted loan short.
 *
 * Invalidations:
 *   - the loan's detail, the officer list and the borrower's /my/gear —
 *     the loan moves from active to history on all three.
 *   - `GEAR_MODELS_QUERY_KEY` — the written-off units stop counting as
 *     "on loan", which every `takeable` subtracts. (They are not put
 *     back on the shelf: stock counts what the club owns, and a lost
 *     draw is corrected by counting the bin.)
 * No gear-detail key: a counted loan has no item page.
 */
export function useWriteOffLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { publicId: string; reason: string }) =>
      writeOffLoanShortfallFn({ data: input }),
    onSuccess: async (result, input) => {
      if (!result.ok) return;
      await Promise.all([
        qc.invalidateQueries({ queryKey: loanDetailQueryKey(input.publicId) }),
        qc.invalidateQueries({ queryKey: LOANS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: MY_LOANS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: GEAR_MODELS_QUERY_KEY }),
      ]);
    },
  });
}
