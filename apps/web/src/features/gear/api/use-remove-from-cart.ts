import { useMutation, useQueryClient } from "@tanstack/react-query";

import { MY_CART_QUERY_KEY } from "#/features/gear/api/query-keys";
import { removeFromCartFn } from "#/features/gear/server/gear-fns";

export function useRemoveFromCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { gearPublicId: string }) =>
      removeFromCartFn({ data: input }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: MY_CART_QUERY_KEY });
    },
  });
}
