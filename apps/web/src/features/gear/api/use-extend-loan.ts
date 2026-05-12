import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  LOANS_QUERY_KEY,
  MY_LOANS_QUERY_KEY,
  loanDetailQueryKey,
} from "#/features/gear/api/query-keys";
import { extendLoanFn } from "#/features/gear/server/gear-fns";

export function useExtendLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { publicId: string; newDueAt: number }) =>
      extendLoanFn({ data: input }),
    onSuccess: async (_data, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: loanDetailQueryKey(input.publicId) }),
        qc.invalidateQueries({ queryKey: LOANS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: MY_LOANS_QUERY_KEY }),
      ]);
    },
  });
}
