import { useMutation, useQueryClient } from "@tanstack/react-query";

import { MY_CART_QUERY_KEY } from "#/features/gear/api/query-keys";
import { addToCartFn } from "#/features/gear/server/gear-fns";
import type { AddToCartResult } from "#/features/gear/server/gear-fns";

/**
 * Add a single gear piece to the member's cart. Returns a typed
 * `AddToCartResult` so callsites can branch on the reason (e.g.
 * `no_code` / `retired`) for a per-row toast — the existing pattern in
 * `useCheckoutLoans` for `CheckoutLoansResult.results[]`.
 *
 * Invalidates `MY_CART_QUERY_KEY` on success so the cart page and the
 * (future) cart badge re-fetch.
 */
export function useAddToCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { gearPublicId: string }): Promise<AddToCartResult> =>
      addToCartFn({ data: input }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: MY_CART_QUERY_KEY });
    },
  });
}
