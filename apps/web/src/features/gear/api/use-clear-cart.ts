import { useMutation, useQueryClient } from "@tanstack/react-query";

import { MY_CART_QUERY_KEY } from "#/features/gear/api/query-keys";
import { clearCartFn } from "#/features/gear/server/gear-fns";

export function useClearCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => clearCartFn(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: MY_CART_QUERY_KEY });
    },
  });
}
