import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GEAR_MODELS_QUERY_KEY,
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
 *   - `GEAR_MODELS_QUERY_KEY` — only when a counted row was submitted:
 *     browse-by-model's `takeable` and the models dialog's "on loan"
 *     both subtract open counted loans. A coded batch leaves it alone,
 *     because a coded piece's availability reaches browse through the
 *     item rollup that `GEAR_QUERY_KEY` already covers.
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
