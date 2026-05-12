import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_QUERY_KEY,
  LOANS_QUERY_KEY,
  MY_LOANS_QUERY_KEY,
  gearDetailQueryKey,
} from "#/features/gear/api/query-keys";
import { checkoutLoansFn } from "#/features/gear/server/gear-fns";
import type { CheckoutLoansInput } from "#/features/gear/server/gear-fns";

/**
 * Bulk checkout: one mutation call ⇒ N loan rows. The result includes
 * per-row outcomes; the caller decides what to surface.
 *
 * Invalidations:
 *   - `LOANS_QUERY_KEY` — the officer-facing /gear/loans list.
 *   - `MY_LOANS_QUERY_KEY` — the borrower's /my/gear (their cache
 *     may be loaded if they were viewing it; harmless to invalidate).
 *   - Each item's `gearDetailQueryKey` — the gear-detail page surfaces
 *     "On loan to X" derived from the open-loan join.
 *   - `GEAR_QUERY_KEY` — the gear browse list shows an "On loan" badge.
 */
export function useCheckoutLoans() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CheckoutLoansInput) => checkoutLoansFn({ data: input }),
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
