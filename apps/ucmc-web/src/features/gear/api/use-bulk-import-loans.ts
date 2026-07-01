import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LOANS_QUERY_KEY } from "#/features/gear/api/query-keys";
import { bulkImportLoansFn } from "#/features/gear/server/gear-fns";
import type { BulkImportLoansInput } from "#/features/gear/server/gear-fns";

/**
 * Bulk-creates many historical loan rows from an officer-supplied CSV
 * (or manual entry). Returns `{ created, skipped }`; the call site
 * renders both. Invalidates the loan list as long as at least one row
 * landed.
 */
export function useBulkImportLoans() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkImportLoansInput) =>
      bulkImportLoansFn({ data: input }),
    onSuccess: async (result) => {
      if (result.created.length > 0) {
        await queryClient.invalidateQueries({ queryKey: LOANS_QUERY_KEY });
      }
    },
  });
}
