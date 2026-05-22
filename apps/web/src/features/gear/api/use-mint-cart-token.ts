import { useMutation } from "@tanstack/react-query";

import { mintCartTokenFn } from "#/features/gear/server/gear-fns";

/**
 * Mint a fresh `ucmc-cart:<uuid>` token snapshotted from the member's
 * current cart. Used by `<CartQrDialog />` — it calls `mutateAsync()`
 * on every dialog open so the QR is always fresh and never reuses a
 * stale (possibly photographed) token across two visits to the cave.
 *
 * No query invalidation: the cart itself isn't mutated by mint, and
 * the token's KV entry is keyed by the random uuid (which the dialog
 * already holds in component state).
 */
export function useMintCartToken() {
  return useMutation({
    mutationFn: () => mintCartTokenFn(),
  });
}
